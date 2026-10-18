//! 当日覆盖表访问。
//!
//! 全量替换语义：命令层传入什么就是什么，未提供的字段写 NULL（= 取消该字段的当日覆盖）。

use crate::error::AppResult;
use crate::models::{DayOverlay, OverlayInput};
use rusqlite::{params, Connection, Row};
use std::collections::HashMap;

pub const COLUMNS: &str = "node_id, date, title, content, visible, force_visible, sort_order, \
                           style_json, created_at, updated_at";

pub fn map_overlay(row: &Row<'_>) -> rusqlite::Result<DayOverlay> {
    Ok(DayOverlay {
        node_id: row.get("node_id")?,
        date: row.get("date")?,
        title: row.get("title")?,
        content: row.get("content")?,
        visible: row.get("visible")?,
        force_visible: row.get("force_visible")?,
        sort_order: row.get("sort_order")?,
        style_json: row.get("style_json")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn get(conn: &Connection, node_id: &str, date: &str) -> AppResult<Option<DayOverlay>> {
    let sql = format!("SELECT {COLUMNS} FROM day_overlays WHERE node_id = ?1 AND date = ?2");
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query_map(params![node_id, date], map_overlay)?;
    match rows.next() {
        Some(r) => Ok(Some(r?)),
        None => Ok(None),
    }
}

pub fn list_by_date(conn: &Connection, date: &str) -> AppResult<Vec<DayOverlay>> {
    let sql = format!("SELECT {COLUMNS} FROM day_overlays WHERE date = ?1");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![date], map_overlay)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn map_by_date(conn: &Connection, date: &str) -> AppResult<HashMap<String, DayOverlay>> {
    Ok(list_by_date(conn, date)?
        .into_iter()
        .map(|o| (o.node_id.clone(), o))
        .collect())
}

pub fn list_by_node(conn: &Connection, node_id: &str, limit: i64) -> AppResult<Vec<DayOverlay>> {
    let sql = format!(
        "SELECT {COLUMNS} FROM day_overlays WHERE node_id = ?1 ORDER BY date DESC LIMIT {}",
        limit.clamp(1, 1000)
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![node_id], map_overlay)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// 保存当日覆盖。所有字段都为空 → 删除该行（等价于「清除当日覆盖」）。
pub fn upsert(conn: &Connection, input: &OverlayInput, now: &str) -> AppResult<Option<DayOverlay>> {
    let is_empty = input.title.is_none()
        && input.content.is_none()
        && input.visible.is_none()
        && input.force_visible.unwrap_or(false) == false
        && input.sort_order.is_none()
        && input.style_json.is_none();

    if is_empty {
        delete(conn, &input.node_id, &input.date)?;
        return Ok(None);
    }

    conn.execute(
        "INSERT INTO day_overlays (node_id, date, title, content, visible, force_visible, \
         sort_order, style_json, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9) \
         ON CONFLICT(node_id, date) DO UPDATE SET \
            title = excluded.title, \
            content = excluded.content, \
            visible = excluded.visible, \
            force_visible = excluded.force_visible, \
            sort_order = excluded.sort_order, \
            style_json = excluded.style_json, \
            updated_at = excluded.updated_at",
        params![
            input.node_id,
            input.date,
            input.title,
            input.content,
            input.visible.map(|v| v as i64),
            input.force_visible.unwrap_or(false) as i64,
            input.sort_order,
            input.style_json,
            now
        ],
    )?;

    get(conn, &input.node_id, &input.date)
}

pub fn delete(conn: &Connection, node_id: &str, date: &str) -> AppResult<usize> {
    Ok(conn.execute(
        "DELETE FROM day_overlays WHERE node_id = ?1 AND date = ?2",
        params![node_id, date],
    )?)
}

/// 物理清空某天的全部覆盖（快照恢复用）。
pub fn delete_by_date(conn: &Connection, date: &str) -> AppResult<usize> {
    Ok(conn.execute("DELETE FROM day_overlays WHERE date = ?1", params![date])?)
}

/// 原样写入一条覆盖（保留原始时间戳，快照恢复用）。
pub fn insert_raw(conn: &Connection, overlay: &DayOverlay) -> AppResult<()> {
    conn.execute(
        "INSERT INTO day_overlays (node_id, date, title, content, visible, force_visible, \
         sort_order, style_json, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            overlay.node_id,
            overlay.date,
            overlay.title,
            overlay.content,
            overlay.visible.map(|v| v as i64),
            overlay.force_visible as i64,
            overlay.sort_order,
            overlay.style_json,
            overlay.created_at,
            overlay.updated_at
        ],
    )?;
    Ok(())
}

pub fn delete_by_node(conn: &Connection, node_id: &str) -> AppResult<usize> {
    Ok(conn.execute(
        "DELETE FROM day_overlays WHERE node_id = ?1",
        params![node_id],
    )?)
}

pub fn count_by_date(conn: &Connection, date: &str) -> AppResult<i64> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM day_overlays WHERE date = ?1",
        params![date],
        |r| r.get(0),
    )?)
}
