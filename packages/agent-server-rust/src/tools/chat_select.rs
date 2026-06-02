use super::exec::{exec_command, ExecOptions};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenChatResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub index: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skipped: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Result from chat-select session enumeration.
#[derive(Debug, Clone)]
pub struct SessionEnumeration {
    pub sessions: HashMap<String, i64>,
    pub current_sel: Option<String>,
    pub pid: String,
    pub build_id_prefix: String,
    pub captured_at: Instant,
}

/// Cache entry for last open_chat result.
#[derive(Debug, Clone)]
struct LastOpenEntry {
    chat_id: String,
    result: OpenChatResult,
    at: Instant,
    pid: String,
}

/// Short-TTL cache for chat-selection data.
struct ChatSelectionCache {
    enumeration: Option<SessionEnumeration>,
    last_open: Option<LastOpenEntry>,
    ttl: Duration,
}

const CACHE_TTL_SECS: u64 = 3;

static CACHE: Mutex<ChatSelectionCache> = Mutex::new(ChatSelectionCache {
    enumeration: None,
    last_open: None,
    ttl: Duration::from_secs(CACHE_TTL_SECS),
});

/// Trait defining the chat-selection backend interface.
///
/// Designed for future replacement by a persistent daemon/service
/// that avoids per-call Frida attach/detach overhead.
pub trait ChatSelectionBackend: Send + Sync {
    fn list_sessions(
        &self,
        exec_options: ExecOptions,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = SessionEnumeration> + Send>>;

    fn current_selection(
        &self,
        exec_options: ExecOptions,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Option<String>> + Send>>;

    fn select_chat(
        &self,
        chat_id: String,
        force: bool,
        click_xy: Option<(f64, f64)>,
        exec_options: ExecOptions,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = OpenChatResult> + Send>>;
}

/// Subprocess-based chat selection backend (uses chat-select.py via CLI).
pub struct SubprocessChatSelection;

impl ChatSelectionBackend for SubprocessChatSelection {
    fn list_sessions(
        &self,
        exec_options: ExecOptions,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = SessionEnumeration> + Send>> {
        Box::pin(async move {
            let result = exec_command("chat-select", &["--list"], &exec_options).await;

            let sessions: HashMap<String, i64> = serde_json::from_str(&result.stdout)
                .ok()
                .and_then(|v: serde_json::Value| v.get("sessions").cloned())
                .and_then(|s| serde_json::from_value(s).ok())
                .unwrap_or_default();

            let pid = extract_log_field(&result.stderr, "PID=");
            let build_id_prefix = extract_log_field(&result.stderr, "prefix=");
            let current_sel = extract_current_sel(&result.stderr);

            SessionEnumeration {
                sessions,
                current_sel,
                pid,
                build_id_prefix,
                captured_at: Instant::now(),
            }
        })
    }

    fn current_selection(
        &self,
        exec_options: ExecOptions,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Option<String>> + Send>> {
        // Check cache first (sync, no await)
        let cached_sel = {
            let cache = CACHE.lock().unwrap();
            cache
                .enumeration
                .as_ref()
                .filter(|e| e.captured_at.elapsed() < cache.ttl)
                .and_then(|e| e.current_sel.clone())
        };
        if let Some(sel) = cached_sel {
            return Box::pin(std::future::ready(Some(sel)));
        }

        Box::pin(async move {
            let enum_result = SubprocessChatSelection.list_sessions(exec_options).await;
            let current_sel = enum_result.current_sel.clone();
            let mut cache = CACHE.lock().unwrap();
            cache.enumeration = Some(enum_result);
            current_sel
        })
    }

    fn select_chat(
        &self,
        chat_id: String,
        force: bool,
        click_xy: Option<(f64, f64)>,
        exec_options: ExecOptions,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = OpenChatResult> + Send>> {
        let pid = get_current_wechat_pid();

        // Check cache (sync, no await)
        if !force {
            let cache = CACHE.lock().unwrap();
            // 1. Same-target last_open skip
            if let Some(entry) = &cache.last_open {
                if entry.chat_id == chat_id
                    && entry.pid == pid
                    && entry.result.ok
                    && entry.at.elapsed() < cache.ttl
                {
                    tracing::info!(
                        "[chat-select] cache hit: same target '{}' within TTL",
                        chat_id
                    );
                    return Box::pin(std::future::ready(entry.result.clone()));
                }
            }
            // 2. current_sel skip from enumeration
            if let Some(e) = &cache.enumeration {
                if e.pid == pid && e.captured_at.elapsed() < cache.ttl {
                    if e.current_sel.as_deref() == Some(chat_id.as_str()) {
                        tracing::info!(
                            "[chat-select] cache hit: current_sel='{}' matches target",
                            chat_id
                        );
                        let result = OpenChatResult {
                            ok: true,
                            username: Some(chat_id.clone()),
                            index: e.sessions.get(&chat_id).copied(),
                            skipped: Some(true),
                            error: None,
                        };
                        return Box::pin(std::future::ready(result));
                    }
                }
            }
        }

        tracing::info!(
            "[chat-select] cache miss: calling subprocess for '{}'",
            chat_id
        );

        Box::pin(async move {
            let mut args: Vec<String> = Vec::new();
            if force {
                args.push("--force".into());
            }
            if let Some((x, y)) = click_xy {
                args.push("--click-xy".into());
                args.push((x as i32).to_string());
                args.push((y as i32).to_string());
            }
            args.push(chat_id.clone());

            let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
            let result = exec_command("chat-select", &args_ref, &exec_options).await;

            let parsed = if let Ok(p) = serde_json::from_str::<OpenChatResult>(&result.stdout) {
                p
            } else {
                OpenChatResult {
                    ok: false,
                    username: None,
                    index: None,
                    skipped: None,
                    error: Some(if result.stderr.is_empty() {
                        format!("chat-select exited with code {}", result.exit_code)
                    } else {
                        result.stderr.clone()
                    }),
                }
            };

            // Update cache
            let build_id_prefix = extract_log_field(&result.stderr, "prefix=");
            let mut cache = CACHE.lock().unwrap();

            // Invalidate if pid/build_id changed
            if let Some(e) = &cache.enumeration {
                if e.pid != pid || e.build_id_prefix != build_id_prefix {
                    tracing::info!("[chat-select] cache invalidated: pid/build_id changed");
                    cache.enumeration = None;
                    cache.last_open = None;
                }
            }

            if parsed.ok {
                cache.last_open = Some(LastOpenEntry {
                    chat_id: chat_id.clone(),
                    result: parsed.clone(),
                    at: Instant::now(),
                    pid,
                });
            } else {
                tracing::info!("[chat-select] cache invalidated: select failed");
                cache.enumeration = None;
                cache.last_open = None;
            }

            parsed
        })
    }
}

static DEFAULT_BACKEND: SubprocessChatSelection = SubprocessChatSelection;

/// Open a chat in the WeChat UI using chat-select with short-TTL cache.
pub async fn open_chat(
    chat_id: &str,
    force: bool,
    click_xy: Option<(f64, f64)>,
    exec_options: &ExecOptions,
) -> OpenChatResult {
    DEFAULT_BACKEND
        .select_chat(chat_id.to_string(), force, click_xy, exec_options.clone())
        .await
}

/// List all chat sessions, using cache when available.
pub async fn list_sessions(exec_options: &ExecOptions) -> SessionEnumeration {
    let pid = get_current_wechat_pid();

    {
        let cache = CACHE.lock().unwrap();
        if let Some(e) = &cache.enumeration {
            if e.pid == pid && e.captured_at.elapsed() < cache.ttl {
                tracing::info!(
                    "[chat-select] enumeration cache hit: {} sessions",
                    e.sessions.len()
                );
                return e.clone();
            }
        }
    }

    tracing::info!("[chat-select] enumeration cache miss: calling subprocess --list");
    let result = DEFAULT_BACKEND.list_sessions(exec_options.clone()).await;

    let mut cache = CACHE.lock().unwrap();
    cache.enumeration = Some(result.clone());
    result
}

/// Get the currently selected chat, using cache when available.
pub async fn current_selection(exec_options: &ExecOptions) -> Option<String> {
    DEFAULT_BACKEND
        .current_selection(exec_options.clone())
        .await
}

/// Invalidate the chat-selection cache (e.g. after WeChat restart).
pub fn invalidate_cache() {
    let mut cache = CACHE.lock().unwrap();
    tracing::info!("[chat-select] cache manually invalidated");
    cache.enumeration = None;
    cache.last_open = None;
}

fn extract_log_field(stderr: &str, prefix: &str) -> String {
    for line in stderr.lines() {
        if let Some(idx) = line.find(prefix) {
            let rest = &line[idx + prefix.len()..];
            let value = rest.split_whitespace().next().unwrap_or(rest);
            return value
                .trim_end_matches(',')
                .trim_end_matches('.')
                .to_string();
        }
    }
    String::new()
}

fn extract_current_sel(stderr: &str) -> Option<String> {
    for line in stderr.lines() {
        if line.contains("Current selection:") {
            let parts: Vec<&str> = line.splitn(2, "Current selection:").collect();
            if parts.len() == 2 {
                let sel = parts[1].trim();
                if !sel.is_empty() && sel != "NONE" {
                    return Some(sel.to_string());
                }
            }
        }
    }
    None
}

/// Get current WeChat PID (fd-count strategy matching Rust find_wechat_pid).
fn get_current_wechat_pid() -> String {
    use std::process::Command;

    for cmd in [
        ["pgrep", "-f", "/usr/bin/wechat"],
        ["pgrep", "-f", "/opt/wechat/wechat"],
        ["pgrep", "-x", "wechat"],
    ] {
        if let Ok(output) = Command::new(cmd[0]).args(&cmd[1..]).output() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let pids: Vec<i64> = stdout
                .split_whitespace()
                .filter_map(|s| s.parse().ok())
                .collect();

            let mut best_pid: Option<i64> = None;
            let mut best_fd_count = 0;
            for pid in pids {
                if let Ok(entries) = std::fs::read_dir(format!("/proc/{pid}/fd")) {
                    let count = entries.count();
                    if count > best_fd_count {
                        best_fd_count = count;
                        best_pid = Some(pid);
                    }
                }
            }

            if let Some(pid) = best_pid {
                return pid.to_string();
            }
            if let Some(first) = stdout.split_whitespace().next() {
                return first.to_string();
            }
        }
    }
    String::new()
}
