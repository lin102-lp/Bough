//! 每日快照表访问（需求 6.6 / 4.7）。
//!
//! 快照内容 = 当天可见节点 + 出现段 + 当日覆盖 + 当天边 + 布局（JSON 全文）。

use crate::error::AppResult;
use crate::models_stage2::{SnapshotPayload, SnapshotSummary};
use rusqlite::{params, Connection};

pub fn upsert(conn: &Connection, payload: &SnapshotPayload) -> AppResult<()> {
    let json = serde_json::to_string(payload)?;
    conn.execute(
        "INSERT INTO daily_snapshots (date, snapshot_json, created_at) VALUES (?1, ?2, ?3) \
         ON CONFLICT(date) DO UPDATE SET snapshot_json = excluded.snapshot_json, \
            created_at = excluded.created_at",
        params![payload.date, json, payload.created_at],
    )?;
    Ok(())
}

pub fn exists(conn: &Connection, date: &str) -> AppResult<bool> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM daily_snapshots WHERE date = ?1",
        params![date],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

/// 读取原始 JSON。
pub fn get_raw(conn: &Connection, date: &str) -> AppResult<Option<(String, String)>> {
    let mut stmt = conn.prepare(
        "SELECT created_at, snapshot_json FROM daily_snapshots WHERE date = ?1",
    )?;
    let mut rows = stmt.query_map(params![date], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    match rows.next() {
        Some(r) => Ok(Some(r?)),
        None => Ok(None),
    }
}

pub fn list(conn: &Connection) -> AppResult<Vec<SnapshotSummary>> {
    let mut stmt = conn.prepare(
        "SELECT date, created_at, snapshot_json FROM daily_snapshots ORDER BY date DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;

    let mut out = Vec::new();
    for r in rows {
        let (date, created_at, json) = r?;
        let size_bytes = json.len();
        // 解析失败也要能列出来，计数给 0
        let parsed: Option<SnapshotPayload> = serde_json::from_str(&json).ok();
        out.push(SnapshotSummary {
            date,
            created_at,
            node_count: parsed.as_ref().map(|p| p.nodes.len()).unwrap_or(0),
            occurrence_count: parsed.as_ref().map(|p| p.occurrences.len()).unwrap_or(0),
            overlay_count: parsed.as_ref().map(|p| p.overlays.len()).unwrap_or(0),
            edge_count: parsed.as_ref().map(|p| p.edges.len()).unwrap_or(0),
            layout_count: parsed.as_ref().map(|p| p.layouts.len()).unwrap_or(0),
            size_bytes,
        });
    }
    Ok(out)
}

pub fn delete(conn: &Connection, date: &str) -> AppResult<usize> {
    Ok(conn.execute(
        "DELETE FROM daily_snapshots WHERE date = ?1",
        params![date],
    )?)
}

pub fn count(conn: &Connection) -> AppResult<i64> {
    Ok(conn.query_row("SELECT COUNT(*) FROM daily_snapshots", [], |r| r.get(0))?)
}
