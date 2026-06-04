use axum::{
    extract::{Path, Query},
    Json,
};
use serde::Deserialize;
use std::collections::HashMap;
use tokio_util::sync::CancellationToken;

use crate::context::create_context;
use crate::db::get_db;
use crate::execution::run_execution_loop;
use crate::ia::types::{MediaResult, MediaVariant, Message, SendResult, SubscriptionEvent};
use crate::plans::send_message::{SendMessageParams, SendMessagePlan};
use crate::sessions::manager::{ensure_logged_in_account, get_session};
use crate::tools::chat_select;
use crate::tools::exec::ExecOptions;
use crate::tools::wechat_chats;
use crate::tools::wechat_db::{find_wechat_pid, list_account_dbs};
use crate::tools::wechat_keys::{extract_keys_async, get_image_keys, get_stored_keys, store_keys};
use crate::tools::wechat_media::get_message_media;
use crate::tools::wechat_messages;

#[derive(Deserialize)]
pub struct ListParams {
    #[serde(default = "default_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}

#[derive(Deserialize)]
pub struct MediaParams {
    #[serde(rename = "ensureDownload", default)]
    ensure_download: bool,
    #[serde(default = "default_media_variant")]
    variant: MediaVariant,
    quality: Option<String>,
}

fn default_limit() -> i64 {
    50
}

fn default_media_variant() -> MediaVariant {
    MediaVariant::Preview
}

async fn ensure_keys_for_media(
    account_dir: &str,
    session_id: &str,
    logged_in_user: &str,
    mut keys: HashMap<String, String>,
) -> HashMap<String, String> {
    let on_disk = list_account_dbs(account_dir);
    let missing: Vec<String> = on_disk
        .iter()
        .filter(|name| {
            let relevant = (name.starts_with("message_") && name.ends_with(".db"))
                || (name.starts_with("media_") && name.ends_with(".db"))
                || (name.starts_with("biz_message_") && name.ends_with(".db"))
                || matches!(
                    name.as_str(),
                    "message_resource.db"
                        | "hardlink.db"
                        | "emoticon.db"
                        | "contact.db"
                        | "session.db"
                );
            relevant && !keys.contains_key(name.as_str())
        })
        .cloned()
        .collect();

    if missing.is_empty() {
        return keys;
    }

    tracing::info!(
        "[media] missing DB keys, refreshing: {}",
        missing.join(", ")
    );
    if let Some(pid) = find_wechat_pid() {
        let extracted = extract_keys_async(pid).await;
        if !extracted.is_empty() {
            let db = get_db();
            store_keys(&db, session_id, logged_in_user, &extracted);
            keys = get_stored_keys(&db, session_id, logged_in_user);
        }
    } else {
        tracing::warn!("[media] cannot refresh DB keys: WeChat PID not found");
    }

    keys
}

pub async fn list_messages(
    Path(chat_id): Path<String>,
    Query(params): Query<ListParams>,
) -> Json<Vec<Message>> {
    let session = match get_session("default") {
        Some(s) => s,
        None => return Json(Vec::new()),
    };
    let logged_in_user = match ensure_logged_in_account(&session).await {
        Some(u) => u,
        None => return Json(Vec::new()),
    };

    let mut keys = {
        let db = get_db();
        get_stored_keys(&db, &session.id, &logged_in_user)
    };

    // Lazy key extraction: if message_*.db files exist on disk without stored keys, re-extract
    let on_disk = list_account_dbs(&logged_in_user);
    let has_missing_message_db = on_disk.iter().any(|name| {
        name.starts_with("message_")
            && name.ends_with(".db")
            && !name.contains("fts")
            && !name.contains("resource")
            && !keys.contains_key(name.as_str())
    });
    if has_missing_message_db {
        if let Some(pid) = find_wechat_pid() {
            let extracted = extract_keys_async(pid).await;
            if !extracted.is_empty() {
                let db = get_db();
                store_keys(&db, &session.id, &logged_in_user, &extracted);
                keys = get_stored_keys(&db, &session.id, &logged_in_user);
            }
        }
    }

    if !keys.keys().any(|k| {
        k.starts_with("message_")
            && k.ends_with(".db")
            && !k.contains("fts")
            && !k.contains("resource")
    }) {
        return Json(Vec::new());
    }

    Json(wechat_messages::list_messages(
        &logged_in_user,
        &keys,
        &chat_id,
        params.limit,
        params.offset,
    ))
}

pub async fn get_media(
    Path((chat_id, local_id)): Path<(String, i64)>,
    Query(params): Query<MediaParams>,
) -> Json<MediaResult> {
    let session = match get_session("default") {
        Some(s) => s,
        None => {
            return Json(MediaResult {
                media_type: "unsupported".to_string(),
                data: None,
                url: None,
                format: String::new(),
                filename: String::new(),
                reason: Some("unsupported".to_string()),
                retryable: Some(false),
            })
        }
    };
    let logged_in_user = match ensure_logged_in_account(&session).await {
        Some(u) => u,
        None => {
            return Json(MediaResult {
                media_type: "unsupported".to_string(),
                data: None,
                url: None,
                format: String::new(),
                filename: String::new(),
                reason: Some("unsupported".to_string()),
                retryable: Some(false),
            })
        }
    };

    let keys = {
        let db = get_db();
        get_stored_keys(&db, &session.id, &logged_in_user)
    };
    let keys = ensure_keys_for_media(&logged_in_user, &session.id, &logged_in_user, keys).await;

    let image_keys = {
        let db = get_db();
        get_image_keys(&db, &session.id, &logged_in_user)
    };

    let mut media = get_message_media(
        &logged_in_user,
        &keys,
        &chat_id,
        local_id,
        image_keys,
        params.variant,
        params.quality.clone(),
    );

    if params.ensure_download && media.retryable == Some(true) {
        let exec_options = ExecOptions {
            session: Some(session.clone()),
            timeout_ms: 30_000,
        };
        let _ = chat_select::open_chat(&chat_id, false, None, &exec_options).await;
        tokio::time::sleep(std::time::Duration::from_millis(1800)).await;

        let refreshed_keys = {
            let db = get_db();
            get_stored_keys(&db, &session.id, &logged_in_user)
        };
        let refreshed_keys = ensure_keys_for_media(
            &logged_in_user,
            &session.id,
            &logged_in_user,
            refreshed_keys,
        )
        .await;
        let refreshed_image_keys = {
            let db = get_db();
            get_image_keys(&db, &session.id, &logged_in_user)
        };
        media = get_message_media(
            &logged_in_user,
            &refreshed_keys,
            &chat_id,
            local_id,
            refreshed_image_keys,
            params.variant,
            params.quality.clone(),
        );
    }

    Json(media)
}

#[derive(Deserialize)]
pub struct SendParams {
    #[serde(rename = "chatId")]
    chat_id: String,
    text: Option<String>,
    image: Option<ImageInput>,
    file: Option<FileInput>,
}

#[derive(Deserialize)]
pub struct ImageInput {
    data: String,
    #[serde(rename = "mimeType")]
    mime_type: String,
}

#[derive(Deserialize)]
pub struct FileInput {
    data: String,
    filename: String,
}

fn send_error(code: &str, message: impl Into<String>) -> SendResult {
    SendResult {
        success: false,
        error: Some(message.into()),
        code: Some(code.to_string()),
        confirmed: None,
        local_id: None,
        confirmation_method: None,
    }
}

pub async fn send_message(Json(input): Json<SendParams>) -> Json<SendResult> {
    if input.text.is_none() && input.image.is_none() && input.file.is_none() {
        return Json(send_error(
            "UPLOAD_FAILED",
            "No text, image, or file provided",
        ));
    }

    let session = match get_session("default") {
        Some(s) => s,
        None => return Json(send_error("AGENT_UNAVAILABLE", "No session available")),
    };

    let Some(logged_in_user) = ensure_logged_in_account(&session).await else {
        return Json(send_error("WECHAT_WINDOW_NOT_FOUND", "NOT_LOGGED_IN"));
    };

    let kind = wechat_chats::classify_chat(&input.chat_id);
    let readonly = matches!(kind.as_str(), "official" | "service" | "system");
    if readonly {
        return Json(send_error("READONLY_CHAT", "当前会话不支持发送"));
    }

    // Decode base64 image to temp file
    let mut image_path: Option<String> = None;
    let mut image_mime: Option<String> = None;
    if let Some(ref img) = input.image {
        let ext = match img.mime_type.as_str() {
            "image/jpeg" => ".jpg",
            "image/gif" => ".gif",
            _ => ".png",
        };
        let path = format!(
            "/tmp/send_image_{}{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis(),
            ext
        );
        let bytes =
            match base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &img.data) {
                Ok(bytes) => bytes,
                Err(e) => {
                    return Json(send_error(
                        "UPLOAD_FAILED",
                        format!("IMAGE_BASE64_DECODE_FAILED: {e}"),
                    ))
                }
            };
        if let Err(e) = std::fs::write(&path, &bytes) {
            return Json(send_error(
                "UPLOAD_FAILED",
                format!("IMAGE_TEMP_WRITE_FAILED: {e}"),
            ));
        }
        image_mime = Some(img.mime_type.clone());
        image_path = Some(path);
    }

    // Decode base64 file to temp file
    let mut file_path: Option<String> = None;
    if let Some(ref f) = input.file {
        // Sanitize filename: keep ASCII alphanumerics, dot, hyphen, underscore;
        // replace everything else (including CJK) with underscore so the temp
        // path stays portable across locales.  The dot is preserved so that
        // file extensions survive (e.g. "遗憾.pdf" → "__.pdf"); the mangled
        // stem is acceptable since this is a transient temp path.
        let safe_name: String = f
            .filename
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        let path = format!(
            "/tmp/send_file_{}_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis(),
            safe_name
        );
        match base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &f.data) {
            Ok(bytes) => match std::fs::write(&path, &bytes) {
                Ok(_) => {
                    file_path = Some(path);
                }
                Err(e) => {
                    return Json(send_error(
                        "UPLOAD_FAILED",
                        format!("Failed to write temp file: {e}"),
                    ));
                }
            },
            Err(e) => {
                return Json(send_error(
                    "UPLOAD_FAILED",
                    format!("Failed to decode base64 file data: {e}"),
                ));
            }
        }
    }

    let mut context = {
        let db = get_db();
        create_context(session, &db)
    };

    // Save values needed for DB confirmation before they are moved
    let chat_id_for_confirm = input.chat_id.clone();
    let session_id_for_confirm = context.session.id.clone();
    let logged_in_user_for_confirm = context.session.logged_in_user.clone();
    let keys_for_confirm = {
        let db = get_db();
        get_stored_keys(&db, &session_id_for_confirm, &logged_in_user)
    };
    let baseline_before_send = wechat_messages::get_latest_self_local_id(
        &logged_in_user,
        &keys_for_confirm,
        &chat_id_for_confirm,
    );

    let plan = SendMessagePlan;
    let params = SendMessageParams {
        chat_id: input.chat_id,
        message: input.text,
        image_path: image_path.clone(),
        image_mime,
        file_path: file_path.clone(),
        readonly,
    };
    let cancel = CancellationToken::new();
    let noop_emit = |_: SubscriptionEvent| {};

    let (result, _plan_state) =
        run_execution_loop(&plan, &params, &mut context, &noop_emit, cancel).await;

    // Clean up temp files
    if let Some(p) = &image_path {
        let _ = std::fs::remove_file(p);
    }
    if let Some(p) = &file_path {
        let _ = std::fs::remove_file(p);
    }

    // ── DB-based send confirmation (P9) ──
    let mut confirmed: Option<bool> = None;
    let mut local_id: Option<i64> = None;
    let mut confirmation_method: Option<String> = None;

    if result.success {
        let logged_in_user = logged_in_user_for_confirm.as_deref().unwrap_or_default();
        if let Some(baseline_id) = baseline_before_send {
            tracing::info!(
                "[send-confirm] Pre-send baseline: chat={} baseline_self_id={}",
                chat_id_for_confirm,
                baseline_id
            );

            // Poll DB for new self message
            let new_id = wechat_messages::poll_db_for_new_self_message(
                logged_in_user,
                &keys_for_confirm,
                &chat_id_for_confirm,
                baseline_id,
                10,  // attempts
                300, // interval_ms
            )
            .await;

            if let Some(confirmed_id) = new_id {
                confirmed = Some(true);
                local_id = Some(confirmed_id);
                confirmation_method = Some("db_poll".to_string());
                tracing::info!(
                    "[send-confirm] DB confirmed: local_id={} method=db_poll",
                    confirmed_id
                );
            } else {
                // UI-based confirmation was the fallback during plan execution
                confirmed = Some(false);
                confirmation_method = Some("ui_disabled".to_string());
                tracing::warn!(
                    "[send-confirm] DB poll could not confirm new self message for chat={} (baseline={})",
                    chat_id_for_confirm, baseline_id
                );
            }
        } else {
            tracing::warn!(
                "[send-confirm] Could not read baseline for chat={} — DB keys may not be available",
                chat_id_for_confirm
            );
            confirmation_method = Some("ui_disabled".to_string());
        }
    }

    Json(SendResult {
        success: result.success,
        code: result
            .error
            .as_ref()
            .and_then(|e| e.split_once(':').map(|(code, _)| code.trim().to_string())),
        error: result.error.map(|e| {
            e.split_once(':')
                .map(|(_, message)| message.trim().to_string())
                .unwrap_or(e)
        }),
        confirmed,
        local_id,
        confirmation_method,
    })
}
