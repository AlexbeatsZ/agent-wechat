use axum::{
    extract::{Path, Query},
    http::StatusCode,
    Json,
};
use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::sessions::manager::get_session;
use crate::tools::server_files::{
    delete_server_file, list_server_files, read_server_file, ServerFile,
};

#[derive(Deserialize)]
pub struct FileListParams {
    #[serde(default = "default_limit")]
    limit: usize,
    #[serde(default)]
    offset: usize,
    #[serde(default = "default_type")]
    r#type: String,
}

#[derive(Deserialize)]
pub struct FileIdParams {
    id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDownloadResponse {
    file: ServerFile,
    data: String,
}

fn default_limit() -> usize {
    100
}

fn default_type() -> String {
    "file".to_string()
}

pub async fn list_files(Query(params): Query<FileListParams>) -> Json<Vec<ServerFile>> {
    let session = match get_session("default") {
        Some(session) => session,
        None => return Json(Vec::new()),
    };
    let logged_in_user = match &session.logged_in_user {
        Some(user) => user.clone(),
        None => return Json(Vec::new()),
    };
    let file_type = match params.r#type.as_str() {
        "image" | "video" | "all" => params.r#type.as_str(),
        _ => "file",
    };
    Json(list_server_files(
        &logged_in_user,
        params.limit.min(200),
        params.offset,
        file_type,
    ))
}

pub async fn download_file(
    Query(params): Query<FileIdParams>,
) -> Result<Json<FileDownloadResponse>, StatusCode> {
    download_file_id(params.id).await
}

pub async fn download_file_by_id(
    Path(id): Path<String>,
) -> Result<Json<FileDownloadResponse>, StatusCode> {
    download_file_id(id).await
}

async fn download_file_id(id: String) -> Result<Json<FileDownloadResponse>, StatusCode> {
    let session = match get_session("default") {
        Some(session) => session,
        None => return Err(StatusCode::NOT_FOUND),
    };
    let logged_in_user = match &session.logged_in_user {
        Some(user) => user.clone(),
        None => return Err(StatusCode::NOT_FOUND),
    };
    read_server_file(&logged_in_user, &id)
        .map(|(file, bytes)| {
            Json(FileDownloadResponse {
                file,
                data: base64::engine::general_purpose::STANDARD.encode(bytes),
            })
        })
        .ok_or(StatusCode::NOT_FOUND)
}

pub async fn delete_file(Query(params): Query<FileIdParams>) -> Json<serde_json::Value> {
    let session = match get_session("default") {
        Some(session) => session,
        None => return Json(serde_json::json!({ "ok": false, "error": "No session available" })),
    };
    let logged_in_user = match &session.logged_in_user {
        Some(user) => user.clone(),
        None => return Json(serde_json::json!({ "ok": false, "error": "NOT_LOGGED_IN" })),
    };
    Json(serde_json::json!({ "ok": delete_server_file(&logged_in_user, &params.id) }))
}
