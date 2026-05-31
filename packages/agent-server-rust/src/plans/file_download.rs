use super::Plan;
use crate::ia::actions;
use crate::ia::selectors::query_selector;
use crate::ia::types::*;
use crate::tools::chat_select::{open_chat, OpenChatResult};

pub struct FileDownloadPlan;

pub struct FileDownloadParams {
    pub chat_id: String,
    pub filename: String,
}

pub struct FileDownloadPlanState {
    phase: FileDownloadPhase,
    pub result: Option<OpenChatResult>,
}

enum FileDownloadPhase {
    Opening,
    ClickingFile,
    Confirming,
    Done,
}

fn find_node_containing<'a>(node: &'a A11yNode, needle: &str) -> Option<&'a A11yNode> {
    let name = node.name.trim();
    if !needle.is_empty()
        && !name.is_empty()
        && (name.contains(needle) || needle.contains(name))
        && node.bounds.is_some()
    {
        return Some(node);
    }

    if let Some(children) = &node.children {
        for child in children {
            if let Some(found) = find_node_containing(child, needle) {
                return Some(found);
            }
        }
    }

    None
}

#[async_trait::async_trait]
impl Plan for FileDownloadPlan {
    type PlanState = FileDownloadPlanState;
    type Params = FileDownloadParams;

    fn id(&self) -> &str {
        "file_download"
    }

    fn initial_plan_state(&self) -> FileDownloadPlanState {
        FileDownloadPlanState {
            phase: FileDownloadPhase::Opening,
            result: None,
        }
    }

    fn is_goal_reached(&self, _state: &AppState, plan_state: &FileDownloadPlanState) -> bool {
        matches!(plan_state.phase, FileDownloadPhase::Done)
    }

    async fn select_action(
        &self,
        state: &AppState,
        params: &FileDownloadParams,
        identified: &IdentifiedStates,
        plan_state: &mut FileDownloadPlanState,
        a11y: &A11yNode,
        session_id: &str,
    ) -> Option<SelectedAction> {
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

        match plan_state.phase {
            FileDownloadPhase::Opening => {
                if main_state_id != Some("chat") && main_state_id != Some("chat_open") {
                    return None;
                }

                let result = open_chat(session_id, &params.chat_id, false, None).await;
                if !result.ok {
                    plan_state.result = Some(result);
                    plan_state.phase = FileDownloadPhase::Done;
                    return None;
                }

                plan_state.result = Some(result);
                plan_state.phase = FileDownloadPhase::ClickingFile;
                Some(SelectedAction {
                    action: actions::wait_long(),
                    frame: identified
                        .main_window
                        .as_ref()
                        .and_then(|m| m.frame.clone()),
                })
            }

            FileDownloadPhase::ClickingFile => {
                if main_state_id != Some("chat_open") {
                    return None;
                }

                let target = find_node_containing(a11y, &params.filename);
                plan_state.phase = FileDownloadPhase::Confirming;

                if let Some(node) = target {
                    if let Some(bounds) = &node.bounds {
                        return Some(SelectedAction {
                            action: actions::sequence(vec![
                                actions::click_bounds(bounds),
                                actions::wait_long(),
                            ]),
                            frame: identified
                                .main_window
                                .as_ref()
                                .and_then(|m| m.frame.clone()),
                        });
                    }
                }

                Some(SelectedAction {
                    action: actions::wait_short(),
                    frame: identified
                        .main_window
                        .as_ref()
                        .and_then(|m| m.frame.clone()),
                })
            }

            FileDownloadPhase::Confirming => {
                plan_state.phase = FileDownloadPhase::Done;

                let selector =
                    r#"push-button[name=/^(Download|Receive|Open|下载|接收|打开|保存)$/]"#;
                if query_selector(a11y, selector).is_some() {
                    return Some(SelectedAction {
                        action: actions::sequence(vec![
                            actions::click_selector(selector),
                            actions::wait_long(),
                        ]),
                        frame: identified
                            .main_window
                            .as_ref()
                            .and_then(|m| m.frame.clone()),
                    });
                }

                Some(SelectedAction {
                    action: actions::wait_long(),
                    frame: identified
                        .main_window
                        .as_ref()
                        .and_then(|m| m.frame.clone()),
                })
            }

            FileDownloadPhase::Done => None,
        }
    }
}
