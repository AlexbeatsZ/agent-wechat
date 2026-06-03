use super::Plan;
use crate::ia::actions;
use crate::ia::helpers::frame_hint_from_node;
use crate::ia::selectors::{is_send_button, query_selector, query_selector_all};
use crate::ia::types::*;
use crate::tools::chat_select::{open_chat, OpenChatResult};
use crate::tools::exec::ExecOptions;

pub struct ChatOpenPlan;

pub struct ChatOpenParams {
    pub chat_id: String,
    pub clear_unreads: bool,
}

pub struct ChatOpenPlanState {
    pub phase: ChatOpenPhase,
    pub result: Option<OpenChatResult>,
}

pub enum ChatOpenPhase {
    Opening,
    Focusing,
    ClickingAudio,
    Done,
}

fn find_edit_area(a11y: &A11yNode) -> Option<&A11yNode> {
    find_edit_near_send(a11y)
}

fn find_edit_near_send(node: &A11yNode) -> Option<&A11yNode> {
    if let Some(children) = &node.children {
        let has_send = find_send_button(node).is_some();
        let edit_node = find_editable_text(node);

        if has_send {
            if let Some(edit) = edit_node {
                return Some(edit);
            }
        }

        // Recurse
        for child in children {
            if let Some(result) = find_edit_near_send(child) {
                return Some(result);
            }
        }
    }
    None
}

fn find_send_button(node: &A11yNode) -> Option<&A11yNode> {
    if is_send_button(node) {
        return Some(node);
    }
    for child in node.children.as_deref().unwrap_or(&[]) {
        if let Some(found) = find_send_button(child) {
            return Some(found);
        }
    }
    None
}

fn find_editable_text(node: &A11yNode) -> Option<&A11yNode> {
    let is_editable = node
        .states
        .as_ref()
        .map(|s| s.iter().any(|st| st == "EDITABLE"))
        .unwrap_or(false);
    if is_editable && matches!(node.role.as_str(), "text" | "paragraph" | "entry") {
        return Some(node);
    }
    for child in node.children.as_deref().unwrap_or(&[]) {
        if let Some(found) = find_editable_text(child) {
            return Some(found);
        }
    }
    None
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
impl Plan for ChatOpenPlan {
    type PlanState = ChatOpenPlanState;
    type Params = ChatOpenParams;

    fn id(&self) -> &str {
        "chat_open"
    }

    fn needs_screenshot(&self) -> bool {
        false
    }

    fn initial_plan_state(&self) -> ChatOpenPlanState {
        ChatOpenPlanState {
            phase: ChatOpenPhase::Opening,
            result: None,
        }
    }

    fn is_goal_reached(&self, _state: &AppState, plan_state: &ChatOpenPlanState) -> bool {
        matches!(plan_state.phase, ChatOpenPhase::Done)
    }

    async fn select_action(
        &self,
        state: &AppState,
        params: &ChatOpenParams,
        identified: &IdentifiedStates,
        plan_state: &mut ChatOpenPlanState,
        a11y: &A11yNode,
        exec_options: &ExecOptions,
    ) -> Option<SelectedAction> {
        if let Some((bounds, frame)) = find_weixin_info_popup_close(a11y) {
            return Some(SelectedAction {
                action: actions::click_bounds(&bounds),
                frame,
            });
        }

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

        let main_state_id = identified.main_window.as_ref().map(|m| m.state_id.as_str());

        loop {
            match &plan_state.phase {
                ChatOpenPhase::Opening => {
                    if main_state_id != Some("chat") && main_state_id != Some("chat_open") {
                        return None;
                    }

                    // Find click target
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
                        plan_state.result = Some(result);
                        return None;
                    }

                    let skipped = result.skipped.unwrap_or(false);
                    plan_state.result = Some(result);

                    if params.clear_unreads {
                        plan_state.phase = ChatOpenPhase::Focusing;
                        tracing::info!("[chat_open] Opening → Focusing, skipped={}", skipped);
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

                    // No clear_unreads — done
                    plan_state.phase = ChatOpenPhase::Done;
                    tracing::info!("[chat_open] Opening → Done (no clear_unreads)");
                    return Some(SelectedAction {
                        action: actions::wait_short(),
                        frame: identified
                            .main_window
                            .as_ref()
                            .and_then(|m| m.frame.clone()),
                    });
                }

                ChatOpenPhase::Focusing => {
                    if main_state_id != Some("chat_open") {
                        tracing::info!("[chat_open] Focusing: wrong state {:?}", main_state_id);
                        return None;
                    }

                    let edit_node = match find_edit_area(a11y) {
                        Some(n) => n,
                        None => {
                            tracing::info!("[chat_open] Focusing: edit area not found");
                            return None;
                        }
                    };

                    plan_state.phase = ChatOpenPhase::ClickingAudio;
                    tracing::info!(
                        "[chat_open] Focusing → ClickingAudio, edit_bounds={:?}",
                        edit_node.bounds
                    );

                    if let Some(bounds) = &edit_node.bounds {
                        return Some(SelectedAction {
                            action: actions::click_bounds(bounds),
                            frame: identified
                                .main_window
                                .as_ref()
                                .and_then(|m| m.frame.clone()),
                        });
                    }
                    continue;
                }

                ChatOpenPhase::ClickingAudio => {
                    if main_state_id != Some("chat_open") {
                        tracing::info!(
                            "[chat_open] ClickingAudio: wrong state {:?}",
                            main_state_id
                        );
                        return None;
                    }

                    let unplayed = query_selector_all(
                        a11y,
                        r#"list[name="Messages"] > list-item[name=/^Audio.*Unplay/s]"#,
                    );

                    // Build a sequence: click each unplayed audio with a wait between
                    let mut seq: Vec<Action> = Vec::new();
                    for node in &unplayed {
                        if let Some(bounds) = &node.bounds {
                            let x = (bounds.x + 100.0).round();
                            let y = (bounds.y + bounds.height / 2.0).round();
                            seq.push(actions::click_at(x, y));
                            seq.push(Action::Wait { ms: 500 });
                        }
                    }
                    tracing::info!(
                        "[chat_open] ClickingAudio: found {} unplayed, sequence of {} actions",
                        unplayed.len(),
                        seq.len()
                    );

                    plan_state.phase = ChatOpenPhase::Done;

                    if seq.is_empty() {
                        return Some(SelectedAction {
                            action: actions::wait_short(),
                            frame: identified
                                .main_window
                                .as_ref()
                                .and_then(|m| m.frame.clone()),
                        });
                    }

                    return Some(SelectedAction {
                        action: Action::Sequence { actions: seq },
                        frame: identified
                            .main_window
                            .as_ref()
                            .and_then(|m| m.frame.clone()),
                    });
                }

                ChatOpenPhase::Done => return None,
            }
        }
    }
}
