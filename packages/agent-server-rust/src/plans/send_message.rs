use super::Plan;
use crate::ia::actions;
use crate::ia::helpers::frame_hint_from_node;
use crate::ia::selectors::{is_send_button, query_selector};
use crate::ia::types::*;
use crate::tools::chat_select::{current_selection, invalidate_cache, open_chat, OpenChatResult};
use crate::tools::exec::{exec_command, ExecOptions};
use crate::tools::tool_capabilities::{
    paste_file_supports_send, paste_image_supports_send, tool_exists,
};

async fn try_lowlevel_text_send(chat_id: &str, message: &str, exec_options: &ExecOptions) -> bool {
    if !tool_exists("send-text-lowlevel", exec_options).await {
        return false;
    }

    let result = exec_command("send-text-lowlevel", &[chat_id, message], exec_options).await;
    if result.exit_code == 0 {
        return true;
    }

    if result.exit_code == 77 {
        tracing::info!(
            "[send_message] low-level text sender unavailable: {}",
            result.stderr.trim()
        );
    } else {
        tracing::warn!(
            "[send_message] low-level text sender failed with code {}: {}",
            result.exit_code,
            result.stderr.trim()
        );
    }
    false
}

pub struct SendMessagePlan;

pub struct SendMessageParams {
    pub chat_id: String,
    pub message: Option<String>,
    pub image_path: Option<String>,
    pub image_mime: Option<String>,
    pub file_path: Option<String>,
    pub readonly: bool,
}

pub enum SendMessagePhase {
    Opening,
    Focusing,
    Inputting,
    Confirming,
    Done,
}

pub struct SendMessagePlanState {
    pub phase: SendMessagePhase,
    pub open_result: Option<OpenChatResult>,
    pub open_wait_attempts: u32,
    pub selected_chat_verified: bool,
    pub selection_verify_attempts: u32,
    pub confirm_attempts: u32,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

impl SendMessagePlanState {
    fn fail(&mut self, code: &str, message: impl Into<String>) {
        self.error_code = Some(code.to_string());
        self.error_message = Some(message.into());
    }
}

fn find_edit_and_send_button(a11y: &A11yNode) -> Option<(&A11yNode, &A11yNode)> {
    find_edit_send_pair(a11y)
}

fn find_edit_send_pair(node: &A11yNode) -> Option<(&A11yNode, &A11yNode)> {
    if let Some(children) = &node.children {
        let send_btn = children.iter().find(|child| is_send_button(child));
        let edit_node = children.iter().find(|child| is_editable_text(child));

        if let (Some(edit), Some(send)) = (edit_node, send_btn) {
            return Some((edit, send));
        }

        if send_btn.is_none() || edit_node.is_none() {
            let btns: Vec<&str> = children
                .iter()
                .filter(|c| c.role == "push-button")
                .map(|c| c.name.as_str())
                .collect();
            if !btns.is_empty() {
                tracing::debug!(
                    "[find_edit_send_pair] push-buttons: {:?}, edit_found: {}",
                    btns,
                    edit_node.is_some()
                );
            }
        }

        for child in children {
            if let Some(result) = find_edit_send_pair(child) {
                return Some(result);
            }
        }
    }
    None
}

fn is_editable_text(node: &A11yNode) -> bool {
    let is_editable = node
        .states
        .as_ref()
        .map(|s| s.iter().any(|st| st == "EDITABLE"))
        .unwrap_or(false);
    is_editable && matches!(node.role.as_str(), "text" | "paragraph" | "entry")
}

fn find_weixin_info_popup_close(a11y: &A11yNode) -> Option<(Bounds, Option<FrameHint>)> {
    if a11y.role == "frame"
        && a11y.name == "Weixin"
        && query_selector(a11y, r#"label[name=/^Weixin [0-9.]+/]"#).is_some()
    {
        let close = query_selector(a11y, r#"tool-bar push-button[name="Disable"]"#)
            .or_else(|| query_selector(a11y, r#"push-button[name="Disable"]"#))?;
        return Some((close.bounds.clone()?, frame_hint_from_node(a11y)));
    }

    for child in a11y.children.as_deref().unwrap_or(&[]) {
        if let Some(found) = find_weixin_info_popup_close(child) {
            return Some(found);
        }
    }
    None
}

#[async_trait::async_trait]
impl Plan for SendMessagePlan {
    type PlanState = SendMessagePlanState;
    type Params = SendMessageParams;

    fn id(&self) -> &str {
        "send_message"
    }

    fn needs_screenshot(&self) -> bool {
        false
    }

    fn initial_plan_state(&self) -> SendMessagePlanState {
        SendMessagePlanState {
            phase: SendMessagePhase::Opening,
            open_result: None,
            open_wait_attempts: 0,
            selected_chat_verified: false,
            selection_verify_attempts: 0,
            confirm_attempts: 0,
            error_code: None,
            error_message: None,
        }
    }

    fn is_goal_reached(&self, _state: &AppState, plan_state: &SendMessagePlanState) -> bool {
        matches!(plan_state.phase, SendMessagePhase::Done)
    }

    fn stuck_error(&self, plan_state: &SendMessagePlanState) -> Option<(String, String)> {
        match (&plan_state.error_code, &plan_state.error_message) {
            (Some(code), Some(message)) => Some((code.clone(), message.clone())),
            _ => None,
        }
    }

    async fn select_action(
        &self,
        state: &AppState,
        params: &SendMessageParams,
        identified: &IdentifiedStates,
        plan_state: &mut SendMessagePlanState,
        a11y: &A11yNode,
        exec_options: &ExecOptions,
    ) -> Option<SelectedAction> {
        let main_state_id = identified.main_window.as_ref().map(|m| m.state_id.as_str());

        if let Some((bounds, frame)) = find_weixin_info_popup_close(a11y) {
            return Some(SelectedAction {
                action: actions::click_bounds(&bounds),
                frame,
            });
        }

        if state.popup.is_some() && identified.popup.is_some() {
            return Some(SelectedAction {
                action: actions::dismiss_popup(),
                frame: identified
                    .main_window
                    .as_ref()
                    .and_then(|m| m.frame.clone()),
            });
        }

        loop {
            match &plan_state.phase {
                SendMessagePhase::Opening => {
                    if params.readonly {
                        plan_state.fail("READONLY_CHAT", "当前会话不支持发送");
                        return None;
                    }

                    if main_state_id == Some("login_account") {
                        return Some(SelectedAction {
                            action: actions::sequence(vec![
                                actions::click_login(),
                                actions::wait_long(),
                            ]),
                            frame: identified
                                .main_window
                                .as_ref()
                                .and_then(|m| m.frame.clone()),
                        });
                    }

                    if main_state_id != Some("chat") && main_state_id != Some("chat_open") {
                        if query_selector(a11y, r#"push-button[name="Weixin"]"#)
                            .or_else(|| query_selector(a11y, r#"push-button[name="WeChat"]"#))
                            .is_some()
                        {
                            return Some(SelectedAction {
                                action: actions::sequence(vec![
                                    actions::click_selector(
                                        r#"push-button[name=/^(Weixin|WeChat)$/]"#,
                                    ),
                                    actions::wait_long(),
                                ]),
                                frame: identified
                                    .main_window
                                    .as_ref()
                                    .and_then(|m| m.frame.clone()),
                            });
                        }
                        plan_state.fail("WECHAT_WINDOW_NOT_FOUND", "微信窗口未进入聊天页");
                        return None;
                    }

                    let chat_list_item = query_selector(a11y, r#"list[name="Chats"] > list-item"#);
                    let click_xy = chat_list_item.and_then(|item| {
                        item.bounds.as_ref().map(|b| {
                            (
                                (b.x + b.width / 2.0).round(),
                                (b.y + b.height / 2.0).round(),
                            )
                        })
                    });

                    let force = main_state_id == Some("chat");
                    let result = open_chat(&params.chat_id, force, click_xy, exec_options).await;

                    if !result.ok {
                        plan_state.fail(
                            "CHAT_NOT_OPENED",
                            result
                                .error
                                .clone()
                                .unwrap_or_else(|| "聊天未打开".to_string()),
                        );
                        return None;
                    }

                    let skipped = result.skipped.unwrap_or(false);
                    plan_state.open_result = Some(result);
                    invalidate_cache();
                    plan_state.phase = SendMessagePhase::Focusing;

                    if !skipped {
                        return Some(SelectedAction {
                            action: actions::wait_short(),
                            frame: identified
                                .main_window
                                .as_ref()
                                .and_then(|m| m.frame.clone()),
                        });
                    }
                    continue;
                }

                SendMessagePhase::Focusing => {
                    if main_state_id != Some("chat_open") {
                        if main_state_id == Some("chat") && plan_state.open_wait_attempts < 20 {
                            plan_state.open_wait_attempts += 1;
                            return Some(SelectedAction {
                                action: actions::wait_short(),
                                frame: identified
                                    .main_window
                                    .as_ref()
                                    .and_then(|m| m.frame.clone()),
                            });
                        }
                        plan_state.fail("CHAT_NOT_OPENED", "聊天未打开");
                        return None;
                    }

                    if !plan_state.selected_chat_verified {
                        match current_selection(exec_options).await {
                            Some(current) if current == params.chat_id => {
                                plan_state.selected_chat_verified = true;
                            }
                            Some(current) => {
                                plan_state.fail(
                                    "CHAT_NOT_OPENED",
                                    format!(
                                        "目标会话校验失败：当前打开的是 {current}，目标是 {}，已阻止发送",
                                        params.chat_id
                                    ),
                                );
                                return None;
                            }
                            None if plan_state.selection_verify_attempts < 3 => {
                                plan_state.selection_verify_attempts += 1;
                                return Some(SelectedAction {
                                    action: actions::wait_short(),
                                    frame: identified
                                        .main_window
                                        .as_ref()
                                        .and_then(|m| m.frame.clone()),
                                });
                            }
                            None => {
                                plan_state.fail(
                                    "CHAT_NOT_OPENED",
                                    "无法校验当前打开的目标会话，已阻止发送",
                                );
                                return None;
                            }
                        }
                    }

                    if params.image_path.is_none() && params.file_path.is_none() {
                        if let Some(msg) = &params.message {
                            if try_lowlevel_text_send(&params.chat_id, msg, exec_options).await {
                                plan_state.phase = SendMessagePhase::Done;
                                return Some(SelectedAction {
                                    action: actions::wait_short(),
                                    frame: identified
                                        .main_window
                                        .as_ref()
                                        .and_then(|m| m.frame.clone()),
                                });
                            }
                        }
                    }

                    let (edit_node, _) = match find_edit_and_send_button(a11y) {
                        Some(found) => found,
                        None => {
                            plan_state.fail("INPUT_NOT_FOUND", "未找到输入框或发送按钮");
                            return None;
                        }
                    };

                    plan_state.phase = SendMessagePhase::Inputting;

                    let is_focused = edit_node
                        .states
                        .as_ref()
                        .map(|s| s.iter().any(|st| st == "FOCUSED"))
                        .unwrap_or(false);

                    if is_focused {
                        continue;
                    }

                    if let Some(bounds) = &edit_node.bounds {
                        return Some(SelectedAction {
                            action: actions::click_bounds(bounds),
                            frame: identified
                                .main_window
                                .as_ref()
                                .and_then(|m| m.frame.clone()),
                        });
                    }

                    plan_state.fail("INPUT_NOT_FOUND", "输入框没有可点击区域");
                    return None;
                }

                SendMessagePhase::Inputting => {
                    let (_, send_btn) = match find_edit_and_send_button(a11y) {
                        Some(found) => found,
                        None => {
                            plan_state.fail("INPUT_NOT_FOUND", "未找到输入框或发送按钮");
                            return None;
                        }
                    };
                    let Some(send_bounds) = send_btn.bounds.clone() else {
                        plan_state.fail("INPUT_NOT_FOUND", "未找到输入框或发送按钮");
                        return None;
                    };

                    plan_state.phase = SendMessagePhase::Confirming;
                    tracing::debug!(
                        "[send_message] tool capabilities: send-text={}, paste-file --send={}, paste-image --send={}",
                        tool_exists("send-text", exec_options).await,
                        paste_file_supports_send(exec_options).await,
                        paste_image_supports_send(exec_options).await
                    );

                    if let Some(fp) = &params.file_path {
                        let result = exec_command("paste-file", &[fp], exec_options).await;
                        if result.exit_code != 0 {
                            tracing::warn!("[send_message] paste-file failed: {}", result.stderr);
                            plan_state.fail(
                                "PASTE_FAILED",
                                if result.stderr.is_empty() {
                                    "文件粘贴失败".to_string()
                                } else {
                                    result.stderr.clone()
                                },
                            );
                            return None;
                        }
                        return Some(SelectedAction {
                            action: Action::Sequence {
                                actions: vec![
                                    Action::Wait { ms: 250 },
                                    actions::click_bounds(&send_bounds),
                                ],
                            },
                            frame: identified
                                .main_window
                                .as_ref()
                                .and_then(|m| m.frame.clone()),
                        });
                    }

                    if let Some(ip) = &params.image_path {
                        let mut args: Vec<&str> = vec![ip];
                        if let Some(mime) = &params.image_mime {
                            args.push(mime);
                        }
                        let result = exec_command("paste-image", &args, exec_options).await;
                        if result.exit_code != 0 {
                            tracing::warn!("[send_message] paste-image failed: {}", result.stderr);
                            plan_state.fail(
                                "PASTE_FAILED",
                                if result.stderr.is_empty() {
                                    "图片粘贴失败".to_string()
                                } else {
                                    result.stderr.clone()
                                },
                            );
                            return None;
                        }
                        return Some(SelectedAction {
                            action: Action::Sequence {
                                actions: vec![
                                    Action::Wait { ms: 250 },
                                    actions::click_bounds(&send_bounds),
                                ],
                            },
                            frame: identified
                                .main_window
                                .as_ref()
                                .and_then(|m| m.frame.clone()),
                        });
                    }

                    if let Some(msg) = &params.message {
                        return Some(SelectedAction {
                            action: Action::SendText { text: msg.clone() },
                            frame: identified
                                .main_window
                                .as_ref()
                                .and_then(|m| m.frame.clone()),
                        });
                    }

                    plan_state.fail("UPLOAD_FAILED", "没有可发送的内容");
                    return None;
                }

                SendMessagePhase::Confirming => {
                    let (_, send_btn) = match find_edit_and_send_button(a11y) {
                        Some(found) => found,
                        None => {
                            plan_state.phase = SendMessagePhase::Done;
                            return Some(SelectedAction {
                                action: actions::wait_short(),
                                frame: identified
                                    .main_window
                                    .as_ref()
                                    .and_then(|m| m.frame.clone()),
                            });
                        }
                    };

                    let is_disabled = send_btn
                        .states
                        .as_ref()
                        .map(|s| s.iter().any(|st| st == "DISABLED"))
                        .unwrap_or(false);

                    if is_disabled {
                        plan_state.phase = SendMessagePhase::Done;
                        return Some(SelectedAction {
                            action: actions::wait_short(),
                            frame: identified
                                .main_window
                                .as_ref()
                                .and_then(|m| m.frame.clone()),
                        });
                    }

                    plan_state.confirm_attempts += 1;
                    if plan_state.confirm_attempts >= 3 {
                        plan_state.phase = SendMessagePhase::Done;
                        return Some(SelectedAction {
                            action: actions::wait_short(),
                            frame: identified
                                .main_window
                                .as_ref()
                                .and_then(|m| m.frame.clone()),
                        });
                    }

                    return Some(SelectedAction {
                        action: actions::wait_short(),
                        frame: identified
                            .main_window
                            .as_ref()
                            .and_then(|m| m.frame.clone()),
                    });
                }

                SendMessagePhase::Done => return None,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::find_edit_and_send_button;
    use crate::ia::types::A11yNode;

    fn node(
        role: &str,
        name: &str,
        states: Option<Vec<&str>>,
        children: Option<Vec<A11yNode>>,
    ) -> A11yNode {
        A11yNode {
            role: role.to_string(),
            name: name.to_string(),
            bounds: None,
            children,
            window: None,
            states: states.map(|items| items.into_iter().map(str::to_string).collect()),
        }
    }

    #[test]
    fn does_not_pair_edit_and_send_across_unrelated_subtrees() {
        let tree = node(
            "frame",
            "root",
            None,
            Some(vec![
                node(
                    "group",
                    "editor-only",
                    None,
                    Some(vec![node("text", "", Some(vec!["EDITABLE"]), None)]),
                ),
                node(
                    "group",
                    "button-only",
                    None,
                    Some(vec![node("push-button", "Send", None, None)]),
                ),
            ]),
        );

        assert!(find_edit_and_send_button(&tree).is_none());
    }

    #[test]
    fn pairs_edit_and_send_within_same_local_container() {
        let tree = node(
            "frame",
            "root",
            None,
            Some(vec![node(
                "group",
                "composer",
                None,
                Some(vec![
                    node("text", "", Some(vec!["EDITABLE"]), None),
                    node("push-button", "发送", None, None),
                ]),
            )]),
        );

        let (edit, send) = find_edit_and_send_button(&tree).expect("pair should be found");
        assert_eq!(edit.role, "text");
        assert_eq!(send.name, "发送");
    }
}
