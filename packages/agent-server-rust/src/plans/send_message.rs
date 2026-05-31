use super::Plan;
use crate::ia::actions;
use crate::ia::compose::{find_compose_area, summarize_compose_candidates};
use crate::ia::types::*;
use crate::sessions::manager::get_session;
use crate::tools::chat_select::{open_chat, OpenChatResult};
use crate::tools::exec::{exec_command, ExecOptions};

pub struct SendMessagePlan;

pub struct SendMessageParams {
    pub chat_id: String,
    pub display_name: Option<String>,
    pub message: Option<String>,
    pub image_path: Option<String>,
    pub image_mime: Option<String>,
    pub file_path: Option<String>,
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
    pub focus_attempts: u32,
    pub reopen_attempts: u32,
    pub confirm_attempts: u32,
    pub fallback_compose_focus: bool,
    pub error: Option<String>,
}

#[async_trait::async_trait]
impl Plan for SendMessagePlan {
    type PlanState = SendMessagePlanState;
    type Params = SendMessageParams;

    fn id(&self) -> &str {
        "send_message"
    }

    fn initial_plan_state(&self) -> SendMessagePlanState {
        SendMessagePlanState {
            phase: SendMessagePhase::Opening,
            open_result: None,
            focus_attempts: 0,
            reopen_attempts: 0,
            confirm_attempts: 0,
            fallback_compose_focus: false,
            error: None,
        }
    }

    fn is_goal_reached(&self, _state: &AppState, plan_state: &SendMessagePlanState) -> bool {
        matches!(plan_state.phase, SendMessagePhase::Done)
    }

    async fn select_action(
        &self,
        state: &AppState,
        params: &SendMessageParams,
        identified: &IdentifiedStates,
        plan_state: &mut SendMessagePlanState,
        a11y: &A11yNode,
        session_id: &str,
    ) -> Option<SelectedAction> {
        let main_state_id = identified.main_window.as_ref().map(|m| m.state_id.as_str());

        // Dismiss popups
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
                    if main_state_id != Some("chat") && main_state_id != Some("chat_open") {
                        plan_state.error = Some("微信窗口未进入聊天页".to_string());
                        return None;
                    }

                    // The in-memory current selection can drift from the visible
                    // UI after reconnects or failed media sends. Sending is
                    // user-visible and should always resynchronize the chat pane.
                    let force = true;
                    let result = open_chat(
                        session_id,
                        &params.chat_id,
                        force,
                        None,
                        params.display_name.as_deref(),
                    )
                    .await;

                    if !result.ok {
                        plan_state.error = Some(
                            result
                                .error
                                .clone()
                                .unwrap_or_else(|| "无法打开聊天".to_string()),
                        );
                        return None;
                    }

                    let skipped = result.skipped.unwrap_or(false);
                    plan_state.open_result = Some(result);
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
                        plan_state.focus_attempts += 1;
                        if plan_state.focus_attempts < 6 {
                            return Some(SelectedAction {
                                action: actions::wait_short(),
                                frame: identified
                                    .main_window
                                    .as_ref()
                                    .and_then(|m| m.frame.clone()),
                            });
                        }
                        if plan_state.reopen_attempts < 1 {
                            plan_state.reopen_attempts += 1;
                            plan_state.focus_attempts = 0;

                            let result = open_chat(
                                session_id,
                                &params.chat_id,
                                true,
                                None,
                                params.display_name.as_deref(),
                            )
                            .await;
                            if !result.ok {
                                plan_state.error = Some(
                                    result
                                        .error
                                        .clone()
                                        .unwrap_or_else(|| "无法重新打开聊天".to_string()),
                                );
                                return None;
                            }
                            plan_state.open_result = Some(result);
                            return Some(SelectedAction {
                                action: actions::wait_short(),
                                frame: identified
                                    .main_window
                                    .as_ref()
                                    .and_then(|m| m.frame.clone()),
                            });
                        }
                        plan_state.error = Some("聊天未打开".to_string());
                        return None;
                    }

                    let found = find_compose_area(a11y);
                    let edit_node = match found {
                        Some(f) => f.edit,
                        None => {
                            plan_state.focus_attempts += 1;
                            if plan_state.focus_attempts < 10 {
                                tracing::info!(
                                    "[send_message] waiting for compose area attempt={}: {}",
                                    plan_state.focus_attempts,
                                    summarize_compose_candidates(a11y)
                                );
                                return Some(SelectedAction {
                                    action: actions::wait(500),
                                    frame: identified
                                        .main_window
                                        .as_ref()
                                        .and_then(|m| m.frame.clone()),
                                });
                            }
                            tracing::warn!(
                                "[send_message] compose area not found while focusing: {}",
                                summarize_compose_candidates(a11y)
                            );
                            plan_state.fallback_compose_focus = true;
                            plan_state.phase = SendMessagePhase::Inputting;
                            return Some(SelectedAction {
                                action: actions::click_at(300.0, 690.0),
                                frame: identified
                                    .main_window
                                    .as_ref()
                                    .and_then(|m| m.frame.clone()),
                            });
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
                    plan_state.error = Some("输入框没有可点击区域".to_string());
                    return None;
                }

                SendMessagePhase::Inputting => {
                    let found = find_compose_area(a11y);
                    if found.is_none() && !plan_state.fallback_compose_focus {
                        tracing::warn!(
                            "[send_message] compose area not found while inputting: {}",
                            summarize_compose_candidates(a11y)
                        );
                        plan_state.error = Some("未找到输入框或发送按钮".to_string());
                        return None;
                    }

                    plan_state.phase = SendMessagePhase::Confirming;

                    // File
                    if let Some(fp) = &params.file_path {
                        let exec_options = get_session(session_id)
                            .or_else(|| get_session("default"))
                            .map(|session| ExecOptions {
                                session: Some(session),
                                timeout_ms: 60_000,
                            })
                            .unwrap_or_default();
                        let paste = exec_command("paste-file", &[fp], &exec_options).await;
                        if paste.exit_code != 0 {
                            let detail = if paste.stderr.is_empty() {
                                paste.stdout
                            } else {
                                paste.stderr
                            };
                            plan_state.error = Some(format!("文件粘贴失败: {detail}"));
                            return None;
                        }
                        plan_state.phase = SendMessagePhase::Done;
                        return Some(SelectedAction {
                            action: actions::sequence(vec![
                                Action::Wait { ms: 100 },
                                Action::Key {
                                    combo: "Return".to_string(),
                                },
                            ]),
                            frame: identified
                                .main_window
                                .as_ref()
                                .and_then(|m| m.frame.clone()),
                        });
                    }

                    // Image
                    if let Some(ip) = &params.image_path {
                        let mut args: Vec<&str> = vec![ip];
                        if let Some(mime) = &params.image_mime {
                            args.push(mime);
                        }
                        let exec_options = get_session(session_id)
                            .or_else(|| get_session("default"))
                            .map(|session| ExecOptions {
                                session: Some(session),
                                timeout_ms: 60_000,
                            })
                            .unwrap_or_default();
                        let paste = exec_command("paste-image", &args, &exec_options).await;
                        if paste.exit_code != 0 {
                            let detail = if paste.stderr.is_empty() {
                                paste.stdout
                            } else {
                                paste.stderr
                            };
                            plan_state.error = Some(format!("图片粘贴失败: {detail}"));
                            return None;
                        }
                        plan_state.phase = SendMessagePhase::Done;
                        return Some(SelectedAction {
                            action: actions::sequence(vec![
                                Action::Wait { ms: 100 },
                                Action::Key {
                                    combo: "Return".to_string(),
                                },
                            ]),
                            frame: identified
                                .main_window
                                .as_ref()
                                .and_then(|m| m.frame.clone()),
                        });
                    }

                    // Text
                    if let Some(msg) = &params.message {
                        plan_state.phase = SendMessagePhase::Done;
                        return Some(SelectedAction {
                            action: actions::sequence(vec![
                                Action::Key {
                                    combo: "ctrl+a".to_string(),
                                },
                                Action::Type {
                                    text: msg.clone(),
                                    selector: None,
                                },
                                Action::Wait { ms: 100 },
                                Action::Key {
                                    combo: "Return".to_string(),
                                },
                            ]),
                            frame: identified
                                .main_window
                                .as_ref()
                                .and_then(|m| m.frame.clone()),
                        });
                    }

                    plan_state.error = Some("没有可发送内容".to_string());
                    return None;
                }

                SendMessagePhase::Confirming => {
                    let found = find_compose_area(a11y);
                    let send_btn = match found.and_then(|f| f.send_button) {
                        Some(f) => f,
                        None => {
                            tracing::warn!(
                                "[send_message] send button not found while confirming: {}",
                                summarize_compose_candidates(a11y)
                            );
                            plan_state.error = Some("未找到输入框或发送按钮".to_string());
                            return None;
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
                    if plan_state.confirm_attempts >= 5 {
                        plan_state.error = Some("发送后未确认完成".to_string());
                        return None;
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
