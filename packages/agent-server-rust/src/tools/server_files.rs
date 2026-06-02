use crate::ia::types::ServerFile;
use base64::Engine;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct ResolvedServerFile {
    pub path: PathBuf,
    pub filename: String,
    pub content_type: String,
}

const ALLOWED_ROOTS: &[&str] = &[
    "msg/file",
    "msg/image",
    "msg/video",
    "msg/voice",
    "msg/attach",
    "cache",
];

fn account_base_paths(account_dir: &str) -> [PathBuf; 2] {
    [
        PathBuf::from(format!("/home/wechat/xwechat_files/{account_dir}")),
        PathBuf::from(format!(
            "/home/wechat/Documents/xwechat_files/{account_dir}"
        )),
    ]
}

fn encode_id(base_index: usize, relative: &Path) -> String {
    let raw = format!(
        "{}:{}",
        base_index,
        relative.to_string_lossy().replace('\\', "/")
    );
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(raw.as_bytes())
}

fn decode_id(id: &str) -> Option<(usize, PathBuf)> {
    let raw = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(id)
        .ok()?;
    let raw = String::from_utf8(raw).ok()?;
    let (base, rel) = raw.split_once(':')?;
    if rel.contains("..") || rel.starts_with('/') || rel.starts_with('\\') {
        return None;
    }
    Some((base.parse().ok()?, PathBuf::from(rel)))
}

pub fn detect_content_type(path: &Path) -> String {
    let head = fs::read(path).unwrap_or_default();
    let b = head.as_slice();
    if b.starts_with(b"%PDF-") {
        "application/pdf"
    } else if b.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else if b.starts_with(&[0xff, 0xd8, 0xff]) {
        "image/jpeg"
    } else if b.starts_with(b"GIF8") {
        "image/gif"
    } else if b.len() >= 12 && b.starts_with(b"RIFF") && &b[8..12] == b"WEBP" {
        "image/webp"
    } else if b.starts_with(b"PK\x03\x04") {
        match path.extension().and_then(|e| e.to_str()).unwrap_or("") {
            "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            _ => "application/zip",
        }
    } else if path.extension().and_then(|e| e.to_str()) == Some("mp4") {
        "video/mp4"
    } else {
        "application/octet-stream"
    }
    .to_string()
}

fn should_include(path: &Path, requested_type: &str) -> bool {
    if requested_type == "all" {
        return true;
    }
    let content_type = detect_content_type(path);
    match requested_type {
        "image" => content_type.starts_with("image/"),
        "video" => content_type.starts_with("video/"),
        "file" => !content_type.starts_with("image/") && !content_type.starts_with("video/"),
        _ => true,
    }
}

fn walk_files(
    base_index: usize,
    base: &Path,
    root: &Path,
    requested_type: &str,
    out: &mut Vec<ServerFile>,
) {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_files(base_index, base, &path, requested_type, out);
            continue;
        }
        if !path.is_file() || !should_include(&path, requested_type) {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.len() == 0 {
            continue;
        }
        let Ok(relative) = path.strip_prefix(base) else {
            continue;
        };
        let modified_at = metadata
            .modified()
            .ok()
            .map(chrono::DateTime::<chrono::Utc>::from)
            .map(|dt| dt.to_rfc3339())
            .unwrap_or_default();
        let filename = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("download")
            .to_string();
        out.push(ServerFile {
            id: encode_id(base_index, relative),
            filename,
            size: metadata.len(),
            modified_at,
            source_path_hint: relative.to_string_lossy().replace('\\', "/"),
            content_type: detect_content_type(&path),
        });
    }
}

pub fn list_server_files(
    account_dir: &str,
    requested_type: &str,
    limit: usize,
    offset: usize,
) -> Vec<ServerFile> {
    let bases = account_base_paths(account_dir);
    let mut out = Vec::new();
    for (base_index, base) in bases.iter().enumerate() {
        for allowed in ALLOWED_ROOTS {
            let root = base.join(allowed);
            walk_files(base_index, base, &root, requested_type, &mut out);
        }
    }
    out.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    out.into_iter().skip(offset).take(limit).collect()
}

pub fn resolve_server_file(account_dir: &str, id: &str) -> Option<ResolvedServerFile> {
    let (base_index, relative) = decode_id(id)?;
    let bases = account_base_paths(account_dir);
    let base = bases.get(base_index)?;
    let allowed = ALLOWED_ROOTS.iter().any(|root| relative.starts_with(root));
    if !allowed {
        return None;
    }
    let path = base.join(&relative);
    let canonical_base = base.canonicalize().ok()?;
    let canonical_path = path.canonicalize().ok()?;
    if !canonical_path.starts_with(canonical_base) || !canonical_path.is_file() {
        return None;
    }
    let filename = canonical_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("download")
        .to_string();
    Some(ResolvedServerFile {
        content_type: detect_content_type(&canonical_path),
        path: canonical_path,
        filename,
    })
}
