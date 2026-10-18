//! 日期图布局表访问。

use crate::error::AppResult;
use crate::models::{DayNodeLayout, LayoutInput};
use rusqlite::{params, Connection, Row};
use std::collections::HashSet;

pub const COLUMNS: &str = "date, node_id, x, y, collapsed, z_index, anchor, level, updated_at";

pub fn map_layout(row: &Row<'_>) -> rusqlite::Result<DayNodeLayout> {
    Ok(DayNodeLayout {
        date: row.get("date")?,
        node_id: row.get("node_id")?,
        x: row.get("x")?,
        y: row.get("y")?,
        collapsed: row.get("collapsed")?,
        z_index: row.get("z_index")?,
        anchor: row.get("anchor")?,
        level: row.get("level")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn list_by_date(conn: &Connection, date: &str) -> AppResult<Vec<DayNodeLayout>> {
    let sql = format!("SELECT {COLUMNS} FROM day_node_layout WHERE date = ?1");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![date], map_layout)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// 当天已有布局的节点 ID 集合（前端据此判断哪些节点需要自动布局）。
pub fn existing_ids(conn: &Connection, date: &str) -> AppResult<HashSet<String>> {
    let mut stmt = conn.prepare("SELECT node_id FROM day_node_layout WHERE date = ?1")?;
    let rows = stmt.query_map(params![date], |row| row.get::<_, String>(0))?;
    let mut out = HashSet::new();
    for r in rows {
        out.insert(r?);
    }
    Ok(out)
}

pub fn get(conn: &Connection, date: &str, node_id: &str) -> AppResult<Option<DayNodeLayout>> {
    let sql = format!("SELECT {COLUMNS} FROM day_node_layout WHERE date = ?1 AND node_id = ?2");
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query_map(params![date, node_id], map_layout)?;
    match rows.next() {
        Some(r) => Ok(Some(r?)),
        None => Ok(None),
    }
}

/// 批量 upsert 当天布局。
pub fn upsert_many(
    conn: &mut Connection,
    date: &str,
    layouts: &[LayoutInput],
    now: &str,
) -> AppResult<usize> {
    let tx = conn.transaction()?;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO day_node_layout (date, node_id, x, y, collapsed, z_index, anchor, level, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) \
             ON CONFLICT(date, node_id) DO UPDATE SET \
                x = excluded.x, y = excluded.y, collapsed = excluded.collapsed, \
                z_index = excluded.z_index, anchor = excluded.anchor, level = excluded.level, \
                updated_at = excluded.updated_at",
        )?;
        for l in layouts {
            stmt.execute(params![
                date,
                l.node_id,
                l.x,
                l.y,
                l.collapsed.unwrap_or(false) as i64,
                l.z_index,
                l.anchor,
                l.level,
                now
            ])?;
        }
    }
    tx.commit()?;
    Ok(layouts.len())
}

pub fn delete_by_date(conn: &Connection, date: &str) -> AppResult<usize> {
    Ok(conn.execute("DELETE FROM day_node_layout WHERE date = ?1", params![date])?)
}

pub fn delete_by_node(conn: &Connection, node_id: &str) -> AppResult<usize> {
    Ok(conn.execute(
        "DELETE FROM day_node_layout WHERE node_id = ?1",
        params![node_id],
    )?)
}

pub fn count_by_date(conn: &Connection, date: &str) -> AppResult<i64> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM day_node_layout WHERE date = ?1",
        params![date],
        |r| r.get(0),
    )?)
}

/// 原样写入一条布局（保留原始时间戳，快照恢复用）。
pub fn insert_raw(conn: &Connection, layout: &DayNodeLayout) -> AppResult<()> {
    conn.execute(
        "INSERT OR REPLACE INTO day_node_layout \
         (date, node_id, x, y, collapsed, z_index, anchor, level, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            layout.date,
            layout.node_id,
            layout.x,
            layout.y,
            layout.collapsed as i64,
            layout.z_index,
            layout.anchor,
            layout.level,
            layout.updated_at
        ],
    )?;
    Ok(())
}
