//! 当日覆盖命令（需求 4.2.5）：只影响某一天的局部编辑。
//!
//! 阶段 2 新增 `force_visible`：「临时可见」标记，用于指向时让目标节点当天显示，
//! 不生成出现段，清除当日覆盖即撤销（需求 4.4.4）。

use crate::commands::audit;
use crate::content;
use crate::error::AppResult;
use crate::models::{DayOverlay, OverlayInput};
use crate::repo;
use crate::state::AppState;
use crate::util;
use tauri::State;

#[tauri::command(async)]
pub fn get_day_overlay(
    state: State<'_, AppState>,
    node_id: String,
    date: String,
) -> AppResult<Option<DayOverlay>> {
    let date = util::ensure_date(&date)?;
    let conn = state.lock();
    repo::overlays::get(&conn, &node_id, &date)
}

/// 保存当日覆盖（全量替换）。所有字段为空 → 删除该行（= 清除当日覆盖）。
#[tauri::command(async)]
pub fn save_day_overlay(
    state: State<'_, AppState>,
    input: OverlayInput,
) -> AppResult<Option<DayOverlay>> {
    let date = util::ensure_date(&input.date)?;
    let conn = state.lock();
    repo::nodes::get_or_err(&conn, &input.node_id)?;
    let now = util::now_iso();

    let before = repo::overlays::get(&conn, &input.node_id, &date)?;
    let normalized = OverlayInput {
        node_id: input.node_id.clone(),
        date: date.clone(),
        title: input.title,
        content: input.content.clone(),
        visible: input.visible,
        force_visible: input.force_visible,
        sort_order: input.sort_order,
        style_json: input.style_json,
    };
    let saved = repo::overlays::upsert(&conn, &normalized, &now)?;

    audit::record(
        &conn,
        "day_overlay",
        &format!("{}:{date}", normalized.node_id),
        if before.is_some() { "update" } else { "create" },
        before.as_ref().and_then(|o| audit::json(o)),
        saved.as_ref().and_then(|o| audit::json(o)),
        None,
    )?;

    // Markdown 镜像（best-effort），便于文件系统直读 / 导出
    content::mirror_overlay_content(
        &state,
        &normalized.date,
        &normalized.node_id,
        normalized.content.as_deref(),
    );
    Ok(saved)
}

#[tauri::command(async)]
pub fn clear_day_overlay(
    state: State<'_, AppState>,
    node_id: String,
    date: String,
) -> AppResult<()> {
    let date = util::ensure_date(&date)?;
    let conn = state.lock();
    let before = repo::overlays::get(&conn, &node_id, &date)?;
    repo::overlays::delete(&conn, &node_id, &date)?;
    audit::record(
        &conn,
        "day_overlay",
        &format!("{node_id}:{date}"),
        "delete",
        before.as_ref().and_then(|o| audit::json(o)),
        None,
        None,
    )?;
    drop(conn);
    content::mirror_overlay_content(&state, &date, &node_id, None);
    Ok(())
}

/// 为某个节点打上/取消「当天临时可见」标记（指向时使用）。
#[tauri::command(async)]
pub fn set_day_force_visible(
    state: State<'_, AppState>,
    node_id: String,
    date: String,
    force: bool,
) -> AppResult<Option<DayOverlay>> {
    let date = util::ensure_date(&date)?;
    let conn = state.lock();
    repo::nodes::get_or_err(&conn, &node_id)?;
    let now = util::now_iso();

    let existing = repo::overlays::get(&conn, &node_id, &date)?;
    let input = OverlayInput {
        node_id: node_id.clone(),
        date: date.clone(),
        title: existing.as_ref().and_then(|o| o.title.clone()),
        content: existing.as_ref().and_then(|o| o.content.clone()),
        visible: existing.as_ref().and_then(|o| o.visible),
        force_visible: Some(force),
        sort_order: existing.as_ref().and_then(|o| o.sort_order),
        style_json: existing.as_ref().and_then(|o| o.style_json.clone()),
    };
    let saved = repo::overlays::upsert(&conn, &input, &now)?;
    audit::record(
        &conn,
        "day_overlay",
        &format!("{node_id}:{date}"),
        if force { "force_visible_on" } else { "force_visible_off" },
        existing.as_ref().and_then(|o| audit::json(o)),
        saved.as_ref().and_then(|o| audit::json(o)),
        None,
    )?;
    Ok(saved)
}
