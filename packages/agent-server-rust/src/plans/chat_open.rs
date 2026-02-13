use super::Plan;
use crate::ia::actions;
use crate::ia::selectors::query_selector;
use crate::ia::types::*;
use crate::tools::chat_select::{open_chat, OpenChatResult};

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
    Done,
}

fn find_edit_area(a11y: &A11yNode) -> Option<&A11yNode> {
    find_edit_near_send(a11y)
}

fn find_edit_near_send(node: &A11yNode) -> Option<&A11yNode> {
    if let Some(children) = &node.children {
        let has_send = children.iter().any(|c| {
            c.role == "push-button" && c.name == "Send(S)"
        });
        let edit_node = children.iter().find(|c| {
            c.role == "text"
                && c.states
                    .as_ref()
                    .map(|s| s.iter().any(|st| st == "EDITABLE"))
                    .unwrap_or(false)
        });

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

#[async_trait::async_trait]
impl Plan for ChatOpenPlan {
    type PlanState = ChatOpenPlanState;
    type Params = ChatOpenParams;

    fn id(&self) -> &str { "chat_open" }

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
        _session_id: &str,
    ) -> Option<SelectedAction> {
        // Dismiss popups
        if state.popup.is_some() && identified.popup.is_some() {
            return Some(SelectedAction {
                action: actions::dismiss_popup(),
                metadata: None,
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
                    let result = open_chat(&params.chat_id, force, click_xy).await;

                    if !result.ok {
                        plan_state.result = Some(result);
                        return None;
                    }

                    let skipped = result.skipped.unwrap_or(false);
                    plan_state.result = Some(result);

                    if params.clear_unreads {
                        plan_state.phase = ChatOpenPhase::Focusing;
                        if !skipped {
                            return Some(SelectedAction {
                                action: actions::wait_short(),
                                metadata: None,
                            });
                        }
                        continue;
                    }

                    // No clear_unreads — done
                    plan_state.phase = ChatOpenPhase::Done;
                    return Some(SelectedAction {
                        action: actions::wait_short(),
                        metadata: None,
                    });
                }

                ChatOpenPhase::Focusing => {
                    if main_state_id != Some("chat_open") {
                        return None;
                    }

                    let edit_node = match find_edit_area(a11y) {
                        Some(n) => n,
                        None => return None,
                    };

                    plan_state.phase = ChatOpenPhase::Done;

                    if let Some(bounds) = &edit_node.bounds {
                        return Some(SelectedAction {
                            action: actions::click_bounds(bounds),
                            metadata: None,
                        });
                    }
                    return None;
                }

                ChatOpenPhase::Done => return None,
            }
        }
    }
}
