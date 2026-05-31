use super::exec::{exec_command, ExecOptions};
use crate::sessions::manager::get_session;
use serde::{Deserialize, Serialize};

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

/// Open a chat in the WeChat UI using the chat-select tool.
///
/// Args format: chat-select [--force] [--click-xy X Y] <username>
pub async fn open_chat(
    session_id: &str,
    chat_id: &str,
    force: bool,
    click_xy: Option<(f64, f64)>,
) -> OpenChatResult {
    let mut args: Vec<String> = Vec::new();

    if force {
        args.push("--force".into());
    }

    if let Some((x, y)) = click_xy {
        args.push("--click-xy".into());
        args.push((x as i32).to_string());
        args.push((y as i32).to_string());
    }

    // chat_id is a positional arg — must be last
    args.push(chat_id.into());

    let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

    let exec_options = get_session(session_id)
        .or_else(|| get_session("default"))
        .map(|session| ExecOptions {
            session: Some(session),
            timeout_ms: 60_000,
        })
        .unwrap_or_default();

    let result = exec_command("chat-select", &args_ref, &exec_options).await;

    // Result JSON is on stdout regardless of exit code
    if let Ok(parsed) = serde_json::from_str::<OpenChatResult>(&result.stdout) {
        return parsed;
    }

    // Fallback: couldn't parse stdout
    OpenChatResult {
        ok: false,
        username: None,
        index: None,
        skipped: None,
        error: Some(if result.stderr.is_empty() {
            format!("chat-select exited with code {}", result.exit_code)
        } else {
            result.stderr
        }),
    }
}
