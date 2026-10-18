//! 当天边表访问。
//!
//! 唯一约束：`(date, from_node_id, to_node_id, type)` 且 `deleted_at IS NULL`（部分唯一索引），
//! 因此软删除后可以重建同样的边。

use crate::error::{AppError, AppResult};
use crate::models::{DayEdge, EdgeInput, EdgeType};
use rusqlite::{params, params_from_iter, Connection, Row};
use rusqlite::types::Value;

pub const COLUMNS: &str = "id, date, from_node_id, to_node_id, type, group_id, copied_from_date, \
                            batch_id, created_at, updated_at, deleted_at";

pub fn map_edge(row: &Row<'_>) -> rusqlite::Result<DayEdge> {
    Ok(DayEdge {
        id: row.get("id")?,
        date: row.get("date")?,
        from_node_id: row.get("from_node_id")?,
        to_node_id: row.get("to_node_id")?,
        kind: row.get("type")?,
        group_id: row.get("group_id")?,
        copied_from_date: row.get("copied_from_date")?,
        batch_id: row.get("batch_id")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        deleted_at: row.get("deleted_at")?,
    })
}

pub fn list_by_date(conn: &Connection, date: &str) -> AppResult<Vec<DayEdge>> {
    let sql = format!(
        "SELECT {COLUMNS} FROM day_edges WHERE date = ?1 AND deleted_at IS NULL ORDER BY created_at ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![date], map_edge)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Option<DayEdge>> {
    let sql = format!("SELECT {COLUMNS} FROM day_edges WHERE id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query_map(params![id], map_edge)?;
    match rows.next() {
        Some(r) => Ok(Some(r?)),
        None => Ok(None),
    }
}

pub fn find(
    conn: &Connection,
    date: &str,
    from: &str,
    to: &str,
    kind: EdgeType,
) -> AppResult<Option<DayEdge>> {
    let sql = format!(
        "SELECT {COLUMNS} FROM day_edges \
         WHERE date = ?1 AND from_node_id = ?2 AND to_node_id = ?3 AND type = ?4 AND deleted_at IS NULL"
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query_map(params![date, from, to, kind], map_edge)?;
    match rows.next() {
        Some(r) => Ok(Some(r?)),
        None => Ok(None),
    }
}

pub fn insert(conn: &Connection, edge: &DayEdge) -> AppResult<()> {
    conn.execute(
        "INSERT INTO day_edges (id, date, from_node_id, to_node_id, type, group_id, copied_from_date, \
         batch_id, created_at, updated_at, deleted_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            edge.id,
            edge.date,
            edge.from_node_id,
            edge.to_node_id,
            edge.kind,
            edge.group_id,
            edge.copied_from_date,
            edge.batch_id,
            edge.created_at,
            edge.updated_at,
            edge.deleted_at,
        ],
    )
    .map_err(|e| AppError::from_sqlite(e, "创建当天边失败（该日期下同起点同终点同类型已存在）"))?;
    Ok(())
}

/// 复制场景使用：冲突时忽略，返回是否真的插入。
pub fn insert_or_ignore(conn: &Connection, edge: &DayEdge) -> AppResult<bool> {
    let changed = conn.execute(
        "INSERT OR IGNORE INTO day_edges (id, date, from_node_id, to_node_id, type, group_id, \
         copied_from_date, batch_id, created_at, updated_at, deleted_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            edge.id,
            edge.date,
            edge.from_node_id,
            edge.to_node_id,
            edge.kind,
            edge.group_id,
            edge.copied_from_date,
            edge.batch_id,
            edge.created_at,
            edge.updated_at,
            edge.deleted_at,
        ],
    )?;
    Ok(changed > 0)
}

pub fn update(conn: &Connection, input: &EdgeInput, now: &str) -> AppResult<DayEdge> {
    let id = input
        .id
        .clone()
        .ok_or_else(|| AppError::invalid("更新边必须提供 id"))?;
    let kind = input.kind.unwrap_or(EdgeType::Single);
    let changed = conn
        .execute(
            "UPDATE day_edges SET date = ?2, from_node_id = ?3, to_node_id = ?4, type = ?5, \
             group_id = ?6, updated_at = ?7 WHERE id = ?1 AND deleted_at IS NULL",
            params![
                id,
                input.date,
                input.from_node_id,
                input.to_node_id,
                kind,
                input.group_id,
                now
            ],
        )
        .map_err(|e| AppError::from_sqlite(e, "更新当天边失败"))?;
    if changed == 0 {
        return Err(AppError::not_found(format!("当天边 {id} 不存在或已删除")));
    }
    get(conn, &id)?.ok_or_else(|| AppError::not_found(format!("当天边 {id} 不存在")))
}

/// 软删除单条边，返回受影响行数。
pub fn soft_delete(conn: &Connection, id: &str, now: &str) -> AppResult<usize> {
    Ok(conn.execute(
        "UPDATE day_edges SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
        params![id, now],
    )?)
}

pub fn soft_delete_many(conn: &Connection, ids: &[String], now: &str) -> AppResult<usize> {
    if ids.is_empty() {
        return Ok(0);
    }
    let placeholders = vec!["?"; ids.len()].join(", ");
    let sql = format!(
        "UPDATE day_edges SET deleted_at = ?, updated_at = ? WHERE id IN ({placeholders}) AND deleted_at IS NULL"
    );
    let mut args: Vec<Value> = vec![Value::Text(now.to_string()), Value::Text(now.to_string())];
    for id in ids {
        args.push(Value::Text(id.clone()));
    }
    Ok(conn.execute(&sql, params_from_iter(args))?)
}

/// 按复制批次撤销（需求 4.2.4 / 4.2.8）。
pub fn soft_delete_batch(conn: &Connection, batch_id: &str, now: &str) -> AppResult<usize> {
    Ok(conn.execute(
        "UPDATE day_edges SET deleted_at = ?2, updated_at = ?2 WHERE batch_id = ?1 AND deleted_at IS NULL",
        params![batch_id, now],
    )?)
}

/// 物理清空某天的全部边（快照恢复用，含已软删除的，避免主键冲突）。
pub fn delete_by_date(conn: &Connection, date: &str) -> AppResult<usize> {
    Ok(conn.execute("DELETE FROM day_edges WHERE date = ?1", params![date])?)
}

/// 恢复一批被软删除的边（撤销「撤销复制」时使用）。
pub fn restore_batch(conn: &Connection, batch_id: &str, now: &str) -> AppResult<usize> {
    Ok(conn.execute(
        "UPDATE day_edges SET deleted_at = NULL, updated_at = ?2 WHERE batch_id = ?1",
        params![batch_id, now],
    )?)
}

/// 恢复单条被软删除的边（撤销「删除边」时使用）。
pub fn restore(conn: &Connection, id: &str, now: &str) -> AppResult<usize> {
    let changed = conn.execute(
        "UPDATE day_edges SET deleted_at = NULL, updated_at = ?2 WHERE id = ?1 \
         AND NOT EXISTS (SELECT 1 FROM day_edges e2 WHERE e2.date = day_edges.date \
            AND e2.from_node_id = day_edges.from_node_id AND e2.to_node_id = day_edges.to_node_id \
            AND e2.type = day_edges.type AND e2.deleted_at IS NULL AND e2.id <> day_edges.id)",
        params![id, now],
    )?;
    if changed == 0 {
        return Err(AppError::conflict(format!(
            "无法恢复边 {id}：该边不存在，或同一天已存在同样的边"
        )));
    }
    Ok(changed)
}

/// 物理删除边（仅用于撤销「会话内新建的边」）。
pub fn purge(conn: &Connection, id: &str) -> AppResult<usize> {
    Ok(conn.execute("DELETE FROM day_edges WHERE id = ?1", params![id])?)
}

pub fn list_by_node(conn: &Connection, node_id: &str, limit: i64) -> AppResult<Vec<DayEdge>> {    let sql = format!(
        "SELECT {COLUMNS} FROM day_edges \
         WHERE (from_node_id = ?1 OR to_node_id = ?1) AND deleted_at IS NULL \
         ORDER BY date DESC, created_at ASC LIMIT {}",
        limit.clamp(1, 5000)
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![node_id], map_edge)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn count_by_date(conn: &Connection, date: &str) -> AppResult<i64> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM day_edges WHERE date = ?1 AND deleted_at IS NULL",
        params![date],
        |r| r.get(0),
    )?)
}

/// 该节点在一段时间内的每日边数量（供时间树统计）。
pub fn count_for_node(conn: &Connection, node_id: &str) -> AppResult<i64> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM day_edges WHERE (from_node_id = ?1 OR to_node_id = ?1) AND deleted_at IS NULL",
        params![node_id],
        |r| r.get(0),
    )?)
}

/// 统计「被指向」次数（type = point 且指向本节点）。
pub fn count_pointed_by(conn: &Connection, node_id: &str) -> AppResult<i64> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM day_edges WHERE to_node_id = ?1 AND type = 'point' AND deleted_at IS NULL",
        params![node_id],
        |r| r.get(0),
    )?)
}
