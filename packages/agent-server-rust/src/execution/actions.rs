use crate::ia::selectors::query_selector;
use crate::ia::types::{A11yNode, Action, SubscriptionEvent};
use crate::tools::exec::{exec_command, ExecOptions};
use std::future::Future;
use std::pin::Pin;

/// Execute a single action against the WeChat UI.
/// Returns a BoxFuture to support recursive calls (Sequence action).
pub fn execute_action<'a>(
    action: &'a Action,
    options: &'a ExecOptions,
    a11y: &'a A11yNode,
    emit: &'a (dyn Fn(SubscriptionEvent) + Send + Sync),
) -> Pin<Box<dyn Future<Output = ()> + Send + 'a>> {
    Box::pin(async move {
        match action {
            Action::ClickSelector { selector } => {
                if let Some(node) = query_selector(a11y, selector) {
                    if let Some(bounds) = &node.bounds {
                        let cx = (bounds.x + bounds.width / 2.0).round() as i32;
                        let cy = (bounds.y + bounds.height / 2.0).round() as i32;
                        tracing::info!("[action] click selector '{selector}' → ({cx}, {cy})");
                        let cx_str = cx.to_string();
                        let cy_str = cy.to_string();
                        exec_command("click", &[&cx_str, &cy_str], options).await;
                    } else {
                        tracing::warn!("[action] click selector '{selector}' matched but no bounds");
                    }
                } else {
                    tracing::warn!("[action] click selector '{selector}' — no match");
                }
            }

            Action::ClickCoords { x, y } => {
                let x_str = (*x as i32).to_string();
                let y_str = (*y as i32).to_string();
                exec_command("click", &[&x_str, &y_str], options).await;
            }

            Action::Type { text, selector: _ } => {
                exec_command("input", &[text.as_str()], options).await;
            }

            Action::Key { combo } => {
                exec_command("key", &[combo.as_str()], options).await;
            }

            Action::Scroll {
                direction,
                x: _,
                y: _,
                amount,
            } => {
                let dir = match direction {
                    crate::ia::types::ScrollDirection::Up => "up",
                    crate::ia::types::ScrollDirection::Down => "down",
                };
                let mut args = vec![dir.to_string()];
                if let Some(amt) = amount {
                    args.push(amt.to_string());
                }
                let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
                exec_command("scroll", &args_ref, options).await;
            }

            Action::Wait { ms } => {
                tokio::time::sleep(std::time::Duration::from_millis(*ms)).await;
            }

            Action::Emit { event } => {
                emit(event.clone());
            }

            Action::Sequence { actions } => {
                for a in actions {
                    execute_action(a, options, a11y, emit).await;
                }
            }
        }
    })
}
