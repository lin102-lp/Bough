//! 布局命令（需求 4.2.7）：每天每个节点一份布局记录。

use crate::error::AppResult;
use crate::models::{DayNodeLayout, LayoutInput};
use crate::repo;
use crate::state::AppState;
use crate::util;
use tauri::State;

#[tauri::command(async)]
pub fn get_day_layouts(state: State<'_, AppState>, date: String) -> AppResult<Vec<DayNodeLayout>> {
    let date = util::ensure_date(&date)?;
    let conn = state.lock();
    repo::layouts::list_by_date(&conn, &date)
}

/// 批量保存当天布局（拖拽结束后调用）。
#[tauri::command(async)]
pub fn save_day_layouts(
    state: State<'_, AppState>,
    date: String,
    layouts: Vec<LayoutInput>,
) -> AppResult<usize> {
    let date = util::ensure_date(&date)?;
    let now = util::now_iso();
    let mut conn = state.lock();
    repo::layouts::upsert_many(&mut conn, &date, &layouts, &now)
}

/// 清空当天布局（下次进入会重新自动布局）。
#[tauri::command(async)]
pub fn reset_day_layouts(state: State<'_, AppState>, date: String) -> AppResult<usize> {
    let date = util::ensure_date(&date)?;
    let conn = state.lock();
    repo::layouts::delete_by_date(&conn, &date)
}
