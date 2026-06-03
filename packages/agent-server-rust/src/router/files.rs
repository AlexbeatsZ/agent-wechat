use axum::{
    body::Body,
    extract::{Path, Query},
    http::{header, HeaderValue, StatusCode},
    response::Response,
    Json,
};
use serde::Deserialize;

use crate::ia::types::ServerFile;
use crate::sessions::manager::{ensure_logged_in_account, get_session};
use crate::tools::server_files::{list_server_files, resolve_server_file};

#[derive(Deserialize)]
pub struct FileListParams {
    #[serde(rename = "type")]
    #[serde(default = "default_type")]
    file_type: String,
    #[serde(default = "default_limit")]
    limit: usize,
    #[serde(default)]
    offset: usize,
}

fn default_type() -> String {
    "all".to_string()
}

fn default_limit() -> usize {
    100
}

pub async fn list_files(Query(params): Query<FileListParams>) -> Json<Vec<ServerFile>> {
    let session = match get_session("default") {
        Some(s) => s,
        None => return Json(Vec::new()),
    };
    let logged_in_user = match ensure_logged_in_account(&session).await {
        Some(u) => u,
        None => return Json(Vec::new()),
    };
    Json(list_server_files(
        &logged_in_user,
        &params.file_type,
        params.limit.min(500),
        params.offset,
    ))
}

pub async fn download_file(Path(id): Path<String>) -> Response {
    let session = match get_session("default") {
        Some(s) => s,
        None => return error_response(StatusCode::UNAUTHORIZED, "NOT_LOGGED_IN", "未登录微信"),
    };
    let logged_in_user = match ensure_logged_in_account(&session).await {
        Some(u) => u,
        None => return error_response(StatusCode::UNAUTHORIZED, "NOT_LOGGED_IN", "未登录微信"),
    };
    let file = match resolve_server_file(&logged_in_user, &id) {
        Some(file) => file,
        None => {
            return error_response(
                StatusCode::NOT_FOUND,
                "FILE_NOT_FOUND",
                "文件不存在或不在允许的微信缓存目录内",
            )
        }
    };
    let data = match tokio::fs::read(&file.path).await {
        Ok(data) => data,
        Err(_) => return error_response(StatusCode::NOT_FOUND, "FILE_NOT_FOUND", "文件读取失败"),
    };
    let mut response = Response::new(Body::from(data));
    *response.status_mut() = StatusCode::OK;
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&file.content_type)
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    let encoded = percent_encode(&file.filename);
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!("attachment; filename*=UTF-8''{encoded}"))
            .unwrap_or_else(|_| HeaderValue::from_static("attachment")),
    );
    response
}

fn error_response(status: StatusCode, code: &str, message: &str) -> Response {
    let body = serde_json::json!({ "code": code, "error": message }).to_string();
    let mut response = Response::new(Body::from(body));
    *response.status_mut() = status;
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json; charset=utf-8"),
    );
    response
}

fn percent_encode(input: &str) -> String {
    input
        .as_bytes()
        .iter()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'.' | b'-' | b'_' => {
                (*b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}
