use base64::Engine;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerFile {
    pub id: String,
    pub filename: String,
    pub size: u64,
    pub modified_at: String,
    pub source_path_hint: String,
    pub content_type: String,
}

fn account_roots(account_dir: &str) -> Vec<PathBuf> {
    vec![
        PathBuf::from(format!("/home/wechat/xwechat_files/{account_dir}")),
        PathBuf::from(format!(
            "/home/wechat/Documents/xwechat_files/{account_dir}"
        )),
    ]
}

fn unix_time(metadata: &fs::Metadata) -> String {
    let seconds = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    chrono::DateTime::from_timestamp(seconds as i64, 0)
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_else(|| "1970-01-01T00:00:00+00:00".to_string())
}

fn detect_content_type(path: &Path) -> String {
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "pdf" => "application/pdf".to_string(),
        "png" => "image/png".to_string(),
        "jpg" | "jpeg" => "image/jpeg".to_string(),
        "gif" => "image/gif".to_string(),
        "webp" => "image/webp".to_string(),
        "mp4" => "video/mp4".to_string(),
        "mov" => "video/quicktime".to_string(),
        "doc" => "application/msword".to_string(),
        "docx" => {
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document".to_string()
        }
        "xls" => "application/vnd.ms-excel".to_string(),
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet".to_string(),
        "ppt" => "application/vnd.ms-powerpoint".to_string(),
        "pptx" => {
            "application/vnd.openxmlformats-officedocument.presentationml.presentation".to_string()
        }
        "zip" => "application/zip".to_string(),
        _ => detect_content_type_from_magic(path)
            .unwrap_or_else(|| "application/octet-stream".to_string()),
    }
}

fn detect_content_type_from_magic(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    if bytes.starts_with(b"%PDF-") {
        return Some("application/pdf".to_string());
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1A\n") {
        return Some("image/png".to_string());
    }
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("image/jpeg".to_string());
    }
    if bytes.starts_with(b"PK\x03\x04") {
        return Some("application/zip".to_string());
    }
    None
}

fn file_id(root_index: usize, relative: &Path) -> String {
    let raw = format!(
        "{}:{}",
        root_index,
        relative.to_string_lossy().replace('\\', "/")
    );
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(raw)
}

fn decode_file_id(id: &str) -> Option<(usize, PathBuf)> {
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(id)
        .ok()?;
    let raw = String::from_utf8(bytes).ok()?;
    let (root, relative) = raw.split_once(':')?;
    if relative.contains("..") || relative.starts_with('/') || relative.starts_with('\\') {
        return None;
    }
    Some((root.parse().ok()?, PathBuf::from(relative)))
}

fn should_include(relative: &Path, file_type: &str) -> bool {
    let rel = relative.to_string_lossy().replace('\\', "/");
    match file_type {
        "all" => {
            rel.starts_with("msg/file/")
                || rel.starts_with("msg/attach/")
                || rel.starts_with("msg/video/")
        }
        "image" => rel.starts_with("msg/attach/"),
        "video" => rel.starts_with("msg/video/"),
        _ => rel.starts_with("msg/file/"),
    }
}

fn walk_files(
    root: &Path,
    current: &Path,
    root_index: usize,
    file_type: &str,
    out: &mut Vec<ServerFile>,
) {
    let entries = match fs::read_dir(current) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if metadata.is_dir() {
            walk_files(root, &path, root_index, file_type, out);
            continue;
        }
        if !metadata.is_file() {
            continue;
        }
        let relative = match path.strip_prefix(root) {
            Ok(relative) => relative,
            Err(_) => continue,
        };
        if !should_include(relative, file_type) {
            continue;
        }
        let filename = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("download")
            .to_string();
        out.push(ServerFile {
            id: file_id(root_index, relative),
            filename,
            size: metadata.len(),
            modified_at: unix_time(&metadata),
            source_path_hint: relative.to_string_lossy().replace('\\', "/"),
            content_type: detect_content_type(&path),
        });
    }
}

pub fn list_server_files(
    account_dir: &str,
    limit: usize,
    offset: usize,
    file_type: &str,
) -> Vec<ServerFile> {
    let mut files = Vec::new();
    for (root_index, root) in account_roots(account_dir).iter().enumerate() {
        if root.exists() {
            walk_files(root, root, root_index, file_type, &mut files);
        }
    }
    files.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    files.into_iter().skip(offset).take(limit).collect()
}

pub fn read_server_file(account_dir: &str, id: &str) -> Option<(ServerFile, Vec<u8>)> {
    let roots = account_roots(account_dir);
    let (root_index, relative) = decode_file_id(id)?;
    let root = roots.get(root_index)?;
    let full = root.join(&relative);
    let root_canon = root.canonicalize().ok()?;
    let full_canon = full.canonicalize().ok()?;
    if !full_canon.starts_with(root_canon)
        || !full_canon.is_file()
        || !should_include(&relative, "all")
    {
        return None;
    }
    let metadata = fs::metadata(&full_canon).ok()?;
    let filename = full_canon.file_name()?.to_string_lossy().to_string();
    let file = ServerFile {
        id: id.to_string(),
        filename,
        size: metadata.len(),
        modified_at: unix_time(&metadata),
        source_path_hint: relative.to_string_lossy().replace('\\', "/"),
        content_type: detect_content_type(&full_canon),
    };
    let data = fs::read(full_canon).ok()?;
    Some((file, data))
}

pub fn delete_server_file(account_dir: &str, id: &str) -> bool {
    let roots = account_roots(account_dir);
    let Some((root_index, relative)) = decode_file_id(id) else {
        return false;
    };
    let Some(root) = roots.get(root_index) else {
        return false;
    };
    let full = root.join(&relative);
    let Ok(root_canon) = root.canonicalize() else {
        return false;
    };
    let Ok(full_canon) = full.canonicalize() else {
        return false;
    };
    if !full_canon.starts_with(root_canon)
        || !full_canon.is_file()
        || !should_include(&relative, "all")
    {
        return false;
    }
    fs::remove_file(full_canon).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_path_traversal_ids() {
        let id = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode("0:../secret.txt");
        assert!(decode_file_id(&id).is_none());
    }

    #[test]
    fn detects_extensionless_pdf_by_magic() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("2026-05(1)");
        fs::write(&path, b"%PDF-1.7\n").unwrap();
        assert_eq!(detect_content_type(&path), "application/pdf");
    }
}
