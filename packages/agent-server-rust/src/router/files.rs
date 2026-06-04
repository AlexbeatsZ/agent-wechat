use axum::{
    body::Body,
    extract::{Path, Query},
    http::{header, HeaderValue, StatusCode},
    response::Response,
    Json,
};
use serde::Deserialize;

use crate::db::get_db;
use crate::ia::types::ServerFile;
use crate::sessions::manager::{ensure_logged_in_account, get_session};
use crate::tools::server_files::{list_server_files, resolve_server_file};
use crate::tools::wechat_keys::get_image_keys;
use crate::tools::wechat_media::decode_image_dat_path;

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
    let mut data = match tokio::fs::read(&file.path).await {
        Ok(data) => data,
        Err(_) => return error_response(StatusCode::NOT_FOUND, "FILE_NOT_FOUND", "file read failed"),
    };
    let mut content_type = file.content_type.clone();
    let mut filename = file.filename.clone();
    if file
        .path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("dat"))
        && data.starts_with(&[0x07, 0x08, 0x56, 0x32, 0x08, 0x07])
    {
        let image_keys = {
            let db = get_db();
            get_image_keys(&db, &session.id, &logged_in_user)
        };
        if let Some((decoded, format, decoded_name)) = decode_image_dat_path(&file.path, image_keys) {
            data = decoded;
            filename = decoded_name;
            content_type = match format.as_str() {
                "jpeg" => "image/jpeg",
                "png" => "image/png",
                "gif" => "image/gif",
                "webp" => "image/webp",
                _ => "application/octet-stream",
            }
            .to_string();
        }
    }
    let mut response = Response::new(Body::from(data));
    *response.status_mut() = StatusCode::OK;
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&content_type)
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    let encoded = percent_encode(&filename);
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

#[cfg(test)]
mod tests {
    use super::percent_encode;

    #[test]
    fn percent_encodes_chinese_filenames_for_content_disposition() {
        assert_eq!(
            percent_encode("测试 文件.pdf"),
            "%E6%B5%8B%E8%AF%95%20%E6%96%87%E4%BB%B6.pdf"
        );
    }
}
