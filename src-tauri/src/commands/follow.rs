//! 子节点跟随覆盖命令（阶段 2，需求 4.1.8 / 6.11）。

use crate::error::{AppError, AppResult};
use crate::models_stage2::{FollowOverride, FollowOverrideInput};
use crate::repo;
use crate::state::AppState;
use crate::util;
use tauri::State;

#[tauri::command(async)]
pub fn list_follow_overrides(
    state: State<'_, AppState>,
    node_id: String,
) -> AppResult<Vec<FollowOverride>> {
    let conn = state.lock();
    repo::follows::list_by_node(&conn, &node_id)
}

/// 设置某个子节点相对父节点的跟随模式（可带生效区间）。
#[tauri::command(async)]
pub fn set_follow_override(
    state: State<'_, AppState>,
    input: FollowOverrideInput,
) -> AppResult<FollowOverride> {
    let start = match input.start_date.as_deref() {
        Some(d) => Some(util::ensure_date(d)?),
        None => None,
    };
    let end = match input.end_date.as_deref() {
        Some(d) => Some(util::ensure_date(d)?),
        None => None,
    };
    if let (Some(s), Some(e)) = (start.as_deref(), end.as_deref()) {
        if e < s {
            return Err(AppError::invalid("跟随覆盖的结束日期不能早于开始日期"));
        }
    }

    let conn = state.lock();
    let node = repo::nodes::get_or_err(&conn, &input.node_id)?;
    if node.parent_id.as_deref() != Some(input.parent_id.as_str()) {
        return Err(AppError::invalid(
            "只能为「当前父节点」设置跟随覆盖，请先修改节点的父节点",
        ));
    }

    let now = util::now_iso();
    let normalized = FollowOverrideInput {
        node_id: input.node_id,
        parent_id: input.parent_id,
        mode: input.mode,
        start_date: start,
        end_date: end,
    };
    repo::follows::upsert(&conn, &normalized, &now)
}

#[tauri::command(async)]
pub fn delete_follow_override(
    state: State<'_, AppState>,
    node_id: String,
    parent_id: String,
) -> AppResult<usize> {
    let conn = state.lock();
    repo::follows::delete(&conn, &node_id, &parent_id)
}
