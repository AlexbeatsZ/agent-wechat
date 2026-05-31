use super::types::A11yNode;

pub struct ComposeArea<'a> {
    pub edit: &'a A11yNode,
    pub send_button: Option<&'a A11yNode>,
}

fn is_editable_text(node: &A11yNode) -> bool {
    node.role == "text"
        && node
            .states
            .as_ref()
            .map(|s| s.iter().any(|st| st == "EDITABLE"))
            .unwrap_or(false)
}

fn is_send_button(node: &A11yNode) -> bool {
    if node.role != "push-button" {
        return false;
    }
    let name = node.name.trim();
    matches!(name, "Send(S)" | "Send" | "发送" | "傳送" | "发送(S)")
}

fn find_send_button(node: &A11yNode) -> Option<&A11yNode> {
    if is_send_button(node) {
        return Some(node);
    }
    if let Some(children) = &node.children {
        for child in children {
            if let Some(result) = find_send_button(child) {
                return Some(result);
            }
        }
    }
    None
}

fn find_pair_near_send(node: &A11yNode) -> Option<ComposeArea<'_>> {
    if let Some(children) = &node.children {
        let send = children.iter().find(|child| is_send_button(child));
        let edit = children.iter().find(|child| is_editable_text(child));
        if let Some(edit) = edit {
            if let Some(send) = send {
                return Some(ComposeArea {
                    edit,
                    send_button: Some(send),
                });
            }
            if let Some(send) = find_send_button(node) {
                return Some(ComposeArea {
                    edit,
                    send_button: Some(send),
                });
            }
        }

        for child in children {
            if let Some(result) = find_pair_near_send(child) {
                return Some(result);
            }
        }
    }
    None
}

fn collect_editable<'a>(node: &'a A11yNode, out: &mut Vec<&'a A11yNode>) {
    if is_editable_text(node) {
        out.push(node);
    }
    if let Some(children) = &node.children {
        for child in children {
            collect_editable(child, out);
        }
    }
}

pub fn find_compose_area(a11y: &A11yNode) -> Option<ComposeArea<'_>> {
    if let Some(pair) = find_pair_near_send(a11y) {
        return Some(pair);
    }

    let mut edits = Vec::new();
    collect_editable(a11y, &mut edits);
    let edit = edits
        .into_iter()
        .filter(|node| {
            node.bounds
                .as_ref()
                .map(|b| b.width >= 120.0 && b.height >= 20.0)
                .unwrap_or(false)
        })
        .max_by(|a, b| {
            let ay = a.bounds.as_ref().map(|bounds| bounds.y).unwrap_or(0.0);
            let by = b.bounds.as_ref().map(|bounds| bounds.y).unwrap_or(0.0);
            ay.partial_cmp(&by).unwrap_or(std::cmp::Ordering::Equal)
        })?;

    Some(ComposeArea {
        edit,
        send_button: find_send_button(a11y),
    })
}

pub fn summarize_compose_candidates(a11y: &A11yNode) -> String {
    let mut edits = Vec::new();
    collect_editable(a11y, &mut edits);
    let send = find_send_button(a11y);
    let edit_summary = edits
        .iter()
        .take(5)
        .map(|node| {
            format!(
                "role={} name={:?} bounds={:?}",
                node.role, node.name, node.bounds
            )
        })
        .collect::<Vec<_>>()
        .join("; ");
    format!(
        "editable_count={} send_button={} edits=[{}]",
        edits.len(),
        send.map(|s| format!("{:?} {:?}", s.name, s.bounds))
            .unwrap_or_else(|| "none".to_string()),
        edit_summary
    )
}
