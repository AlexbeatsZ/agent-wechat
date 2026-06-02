use crate::ia::types::{AppState, Effect};

/// Collect effects from all watchers.
///
/// DEPRECATED: The effect system is currently unused — all emissions are handled
/// directly by plans. This function always returns an empty Vec. It exists as a
/// placeholder for future reactive side-effect architecture.
pub fn collect_effects(_prev: &AppState, _next: &AppState) -> Vec<Effect> {
    Vec::new()
}
