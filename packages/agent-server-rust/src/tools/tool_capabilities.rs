use super::exec::{exec_command, ExecOptions};
use std::path::Path;

fn tool_path(name: &str) -> String {
    format!("/opt/tools/{name}")
}

fn shell_single_quote(value: &str) -> String {
    value.replace('\'', "'\"'\"'")
}

pub async fn tool_exists(name: &str, exec_options: &ExecOptions) -> bool {
    let path = tool_path(name);
    if Path::new(&path).is_file() {
        return true;
    }

    let script = format!("command -v '{}' >/dev/null 2>&1", shell_single_quote(name));
    let result = exec_command("sh", &["-lc", &script], exec_options).await;
    result.exit_code == 0
}

async fn tool_supports_send_flag(name: &str, exec_options: &ExecOptions) -> bool {
    let path = tool_path(name);
    if Path::new(&path).is_file() {
        if let Ok(contents) = std::fs::read_to_string(&path) {
            return contents.contains("--send");
        }
    }

    let script = format!(
        "tool=$(command -v '{}' 2>/dev/null) && [ -n \"$tool\" ] && grep -q -- '--send' \"$tool\"",
        shell_single_quote(name)
    );
    let result = exec_command("sh", &["-lc", &script], exec_options).await;
    result.exit_code == 0
}

pub async fn paste_file_supports_send(exec_options: &ExecOptions) -> bool {
    tool_supports_send_flag("paste-file", exec_options).await
}

pub async fn paste_image_supports_send(exec_options: &ExecOptions) -> bool {
    tool_supports_send_flag("paste-image", exec_options).await
}
