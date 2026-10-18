//! 子节点跟随覆盖表访问（需求 6.11、4.1.8）。
//!
//! 语义：每个节点相对它的父节点，可以覆盖跟随模式；支持生效区间（空 = 不限）。

use crate::error::AppResult;
use crate::models::FollowMode;
use crate::models_stage2::{FollowOverride, FollowOverrideInput};
use rusqlite::{params, Connection, Row};
use std::collections::HashMap;

pub const COLUMNS: &str = "node_id, parent_id, mode, start_date, end_date, created_at, updated_at";

pub fn map_row(row: &Row<'_>) -> rusqlite::Result<FollowOverride> {
    Ok(FollowOverride {
        node_id: row.get("node_id")?,
        parent_id: row.get("parent_id")?,
        mode: row.get("mode")?,
        start_date: row.get("start_date")?,
        end_date: row.get("end_date")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn list_all(conn: &Connection) -> AppResult<Vec<FollowOverride>> {
    let sql = format!("SELECT {COLUMNS} FROM node_follow_overrides ORDER BY node_id");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], map_row)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn list_by_node(conn: &Connection, node_id: &str) -> AppResult<Vec<FollowOverride>> {
    let sql = format!("SELECT {COLUMNS} FROM node_follow_overrides WHERE node_id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![node_id], map_row)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// 取出在指定日期生效的跟随覆盖：node_id → mode（供可见性引擎使用）。
pub fn map_active(conn: &Connection, date: &str) -> AppResult<HashMap<String, FollowMode>> {
    let sql = format!(
        "SELECT {COLUMNS} FROM node_follow_overrides \
         WHERE (start_date IS NULL OR start_date <= ?1) \
           AND (end_date IS NULL OR end_date >= ?1)"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![date], map_row)?;
    let mut map = HashMap::new();
    for r in rows {
        let item = r?;
        map.insert(item.node_id, item.mode);
    }
    Ok(map)
}

pub fn upsert(
    conn: &Connection,
    input: &FollowOverrideInput,
    now: &str,
) -> AppResult<FollowOverride> {
    let mode = input.mode.unwrap_or(FollowMode::Default);
    conn.execute(
        "INSERT INTO node_follow_overrides \
         (node_id, parent_id, mode, start_date, end_date, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6) \
         ON CONFLICT(node_id, parent_id) DO UPDATE SET \
            mode = excluded.mode, start_date = excluded.start_date, \
            end_date = excluded.end_date, updated_at = excluded.updated_at",
        params![
            input.node_id,
            input.parent_id,
            mode,
            input.start_date,
            input.end_date,
            now
        ],
    )?;

    let sql = format!(
        "SELECT {COLUMNS} FROM node_follow_overrides WHERE node_id = ?1 AND parent_id = ?2"
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query_map(params![input.node_id, input.parent_id], map_row)?;
    rows.next()
        .transpose()?
        .ok_or_else(|| crate::error::AppError::not_found("保存跟随覆盖后读取失败"))
}

pub fn delete(conn: &Connection, node_id: &str, parent_id: &str) -> AppResult<usize> {
    Ok(conn.execute(
        "DELETE FROM node_follow_overrides WHERE node_id = ?1 AND parent_id = ?2",
        params![node_id, parent_id],
    )?)
}
