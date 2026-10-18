//! 操作记录与每日快照命令（阶段 2，需求 4.7 / 6.5 / 6.6）。

use std::collections::HashSet;

use rusqlite::Connection;

use crate::commands::audit;
use crate::error::{AppError, AppResult};
use crate::models_stage2::{
    OperationFilter, OperationRecord, RestoreResult, SnapshotPayload, SnapshotSummary,
};
use crate::repo;
use crate::state::AppState;
use crate::util;
use tauri::State;

/// 收集某一天的完整快照内容。
pub fn build_snapshot(conn: &Connection, date: &str) -> AppResult<SnapshotPayload> {
    let overlays = repo::overlays::list_by_date(conn, date)?;
    let edges = repo::edges::list_by_date(conn, date)?;
    let layouts = repo::layouts::list_by_date(conn, date)?;
    let occurrences = repo::occurrences::list_covering(conn, date)?;

    // 只保存当天真正相关的节点，避免快照里塞进整库
    let mut ids: HashSet<String> = HashSet::new();
    for o in &occurrences {
        ids.insert(o.node_id.clone());
    }
    for o in &overlays {
        ids.insert(o.node_id.clone());
    }
    for e in &edges {
        ids.insert(e.from_node_id.clone());
        ids.insert(e.to_node_id.clone());
    }
    for l in &layouts {
        ids.insert(l.node_id.clone());
    }

    let mut nodes = Vec::new();
    for id in ids {
        if let Some(node) = repo::nodes::get(conn, &id)? {
            nodes.push(node);
        }
    }

    Ok(SnapshotPayload {
        date: date.to_string(),
        created_at: util::now_iso(),
        nodes,
        occurrences,
        overlays,
        edges,
        layouts,
    })
}

fn summarize(payload: &SnapshotPayload, size_bytes: usize) -> SnapshotSummary {
    SnapshotSummary {
        date: payload.date.clone(),
        created_at: payload.created_at.clone(),
        node_count: payload.nodes.len(),
        occurrence_count: payload.occurrences.len(),
        overlay_count: payload.overlays.len(),
        edge_count: payload.edges.len(),
        layout_count: payload.layouts.len(),
        size_bytes,
    }
}

/// 列出操作记录（默认最近 200 条）。
#[tauri::command(async)]
pub fn list_operations(
    state: State<'_, AppState>,
    filter: Option<OperationFilter>,
) -> AppResult<Vec<OperationRecord>> {
    let conn = state.lock();
    repo::operations::list(&conn, &filter.unwrap_or_default())
}

#[tauri::command(async)]
pub fn list_snapshots(state: State<'_, AppState>) -> AppResult<Vec<SnapshotSummary>> {
    let conn = state.lock();
    repo::snapshots::list(&conn)
}

/// 强制重拍当天快照（覆盖已有快照）。
#[tauri::command(async)]
pub fn create_snapshot(state: State<'_, AppState>, date: String) -> AppResult<SnapshotSummary> {
    let date = util::ensure_date(&date)?;
    let conn = state.lock();
    let payload = build_snapshot(&conn, &date)?;
    let size = serde_json::to_string(&payload)?.len();
    repo::snapshots::upsert(&conn, &payload)?;
    audit::record(
        &conn,
        "snapshot",
        &date,
        "create",
        None,
        None,
        None,
    )?;
    Ok(summarize(&payload, size))
}

/// 每天首次进入某个日期时自动生成一份快照（已存在则跳过）。
#[tauri::command(async)]
pub fn ensure_daily_snapshot(
    state: State<'_, AppState>,
    date: String,
) -> AppResult<Option<SnapshotSummary>> {
    let date = util::ensure_date(&date)?;
    let conn = state.lock();
    if repo::snapshots::exists(&conn, &date)? {
        return Ok(None);
    }
    let payload = build_snapshot(&conn, &date)?;
    let size = serde_json::to_string(&payload)?.len();
    repo::snapshots::upsert(&conn, &payload)?;
    Ok(Some(summarize(&payload, size)))
}

#[tauri::command(async)]
pub fn delete_snapshot(state: State<'_, AppState>, date: String) -> AppResult<usize> {
    let date = util::ensure_date(&date)?;
    let conn = state.lock();
    repo::snapshots::delete(&conn, &date)
}

/// 恢复某天快照：覆盖当天的当日覆盖、当天边、布局三类「日粒度」数据。
///
/// 说明：节点本体与出现段是**跨天**数据，恢复它们会影响其他日期，
/// 因此这里只恢复日粒度数据（如需整体回滚请用文件级备份）。
#[tauri::command(async)]
pub fn restore_snapshot(state: State<'_, AppState>, date: String) -> AppResult<RestoreResult> {
    let date = util::ensure_date(&date)?;
    let conn = state.lock();

    let (_created_at, json) = repo::snapshots::get_raw(&conn, &date)?
        .ok_or_else(|| AppError::not_found(format!("{date} 还没有快照")))?;
    let payload: SnapshotPayload = serde_json::from_str(&json)
        .map_err(|e| AppError::invalid(format!("快照内容损坏：{e}")))?;

    if payload.date != date {
        return Err(AppError::invalid("快照日期与请求日期不一致"));
    }

    let missing_nodes = payload
        .nodes
        .iter()
        .filter(|n| repo::nodes::get(&conn, &n.id).ok().flatten().is_none())
        .count();

    // 清空当天数据（含软删除的边，避免主键冲突）
    repo::edges::delete_by_date(&conn, &date)?;
    repo::overlays::delete_by_date(&conn, &date)?;
    repo::layouts::delete_by_date(&conn, &date)?;

    for edge in &payload.edges {
        repo::edges::insert(&conn, edge)?;
    }
    for overlay in &payload.overlays {
        repo::overlays::insert_raw(&conn, overlay)?;
    }
    for layout in &payload.layouts {
        repo::layouts::insert_raw(&conn, layout)?;
    }

    audit::record(
        &conn,
        "snapshot",
        &date,
        "restore",
        None,
        audit::json(&payload),
        None,
    )?;

    Ok(RestoreResult {
        date,
        snapshot_created_at: payload.created_at,
        restored_edges: payload.edges.len(),
        restored_overlays: payload.overlays.len(),
        restored_layouts: payload.layouts.len(),
        missing_nodes,
    })
}
