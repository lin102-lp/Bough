//! 出现段命令：手动延续 / 重新出现 / 增删改（需求 4.1.7、4.1.10）。

use crate::commands::audit;
use crate::error::{AppError, AppResult};
use crate::models::{Occurrence, OccurrenceInput, OccurrenceSource};
use crate::repo;
use crate::state::AppState;
use crate::util;
use tauri::State;

#[tauri::command(async)]
pub fn list_occurrences(state: State<'_, AppState>, node_id: String) -> AppResult<Vec<Occurrence>> {
    let conn = state.lock();
    repo::occurrences::list_by_node(&conn, &node_id)
}

#[tauri::command(async)]
pub fn add_occurrence(
    state: State<'_, AppState>,
    input: OccurrenceInput,
) -> AppResult<Occurrence> {
    let start = util::ensure_date(&input.start_date)?;
    let end = match input.end_date.as_deref() {
        Some(d) => Some(util::ensure_date(d)?),
        None => None,
    };
    if let Some(e) = end.as_deref() {
        if e < start.as_str() {
            return Err(AppError::invalid("出现段结束日期不能早于开始日期"));
        }
    }
    let conn = state.lock();
    repo::nodes::get_or_err(&conn, &input.node_id)?;
    let now = util::now_iso();
    let normalized = OccurrenceInput {
        id: None,
        node_id: input.node_id,
        start_date: start,
        end_date: end,
        source: input.source,
        is_manual_reappear: input.is_manual_reappear,
    };
    repo::occurrences::insert(&conn, &normalized, &now)
}

#[tauri::command(async)]
pub fn update_occurrence(
    state: State<'_, AppState>,
    input: OccurrenceInput,
) -> AppResult<Occurrence> {
    let id = input
        .id
        .ok_or_else(|| AppError::invalid("更新出现段必须提供 id"))?;
    let start = util::ensure_date(&input.start_date)?;
    let end = match input.end_date.as_deref() {
        Some(d) => Some(util::ensure_date(d)?),
        None => None,
    };
    if let Some(e) = end.as_deref() {
        if e < start.as_str() {
            return Err(AppError::invalid("出现段结束日期不能早于开始日期"));
        }
    }
    let conn = state.lock();
    let now = util::now_iso();
    let source = input.source.unwrap_or(OccurrenceSource::Manual);
    let is_reappear = input
        .is_manual_reappear
        .unwrap_or(source == OccurrenceSource::Reappear);
    repo::occurrences::update(&conn, id, &start, end.as_deref(), source, is_reappear, &now)
}

#[tauri::command(async)]
pub fn delete_occurrence(state: State<'_, AppState>, occurrence_id: i64) -> AppResult<()> {
    let conn = state.lock();
    let before = repo::occurrences::get(&conn, occurrence_id)?;
    repo::occurrences::delete(&conn, occurrence_id)?;
    if let Some(occ) = before.as_ref() {
        let _ = audit::record(
            &conn,
            "occurrence",
            &format!("{}#{}", occ.node_id, occ.id),
            "delete",
            audit::json(occ),
            None,
            None,
        );
    }
    Ok(())
}

/// 手动延续到次日：新增一个从次日开始的开放出现段（来源标记 `manual`）。
///
/// `keep_open = false` 时生成的段只覆盖次日一天（等价于「只借一天」）。
#[tauri::command(async)]
pub fn continue_node_to_next_day(
    state: State<'_, AppState>,
    node_id: String,
    from_date: Option<String>,
    keep_open: Option<bool>,
) -> AppResult<Occurrence> {
    let base = match from_date.as_deref() {
        Some(d) => util::ensure_date(d)?,
        None => util::today_str(),
    };
    let start = util::next_day(&base)?;
    let open = keep_open.unwrap_or(true);
    let conn = state.lock();
    repo::nodes::get_or_err(&conn, &node_id)?;
    let now = util::now_iso();
    let input = OccurrenceInput {
        id: None,
        node_id,
        start_date: start.clone(),
        end_date: if open { None } else { Some(start) },
        source: Some(OccurrenceSource::Manual),
        is_manual_reappear: Some(false),
    };
    repo::occurrences::insert(&conn, &input, &now)
}

/// 手动重新出现：从指定日期新增一个开放出现段（来源标记 `reappear`）。
#[tauri::command(async)]
pub fn reappear_node(
    state: State<'_, AppState>,
    node_id: String,
    date: String,
    keep_open: Option<bool>,
) -> AppResult<Occurrence> {
    let start = util::ensure_date(&date)?;
    let open = keep_open.unwrap_or(true);
    let conn = state.lock();
    repo::nodes::get_or_err(&conn, &node_id)?;
    let now = util::now_iso();
    let input = OccurrenceInput {
        id: None,
        node_id,
        start_date: start.clone(),
        end_date: if open { None } else { Some(start) },
        source: Some(OccurrenceSource::Reappear),
        is_manual_reappear: Some(true),
    };
    repo::occurrences::insert(&conn, &input, &now)
}
