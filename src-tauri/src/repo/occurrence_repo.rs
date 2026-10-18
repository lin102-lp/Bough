//! 出现段表访问。

use crate::error::{AppError, AppResult};
use crate::models::{Continuation, Occurrence, OccurrenceInput, OccurrenceSource};
use rusqlite::{params, Connection, Row};
use std::collections::HashMap;

pub const COLUMNS: &str = "id, node_id, start_date, end_date, source, is_manual_reappear, created_at, updated_at";

pub fn map_occurrence(row: &Row<'_>) -> rusqlite::Result<Occurrence> {
    Ok(Occurrence {
        id: row.get("id")?,
        node_id: row.get("node_id")?,
        start_date: row.get("start_date")?,
        end_date: row.get("end_date")?,
        source: row.get("source")?,
        is_manual_reappear: row.get("is_manual_reappear")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn list_by_node(conn: &Connection, node_id: &str) -> AppResult<Vec<Occurrence>> {
    let sql = format!("SELECT {COLUMNS} FROM occurrences WHERE node_id = ?1 ORDER BY start_date ASC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![node_id], map_occurrence)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn list_all(conn: &Connection) -> AppResult<Vec<Occurrence>> {
    let sql = format!("SELECT {COLUMNS} FROM occurrences ORDER BY node_id, start_date");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], map_occurrence)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Option<Occurrence>> {
    let sql = format!("SELECT {COLUMNS} FROM occurrences WHERE id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query_map(params![id], map_occurrence)?;
    match rows.next() {
        Some(r) => Ok(Some(r?)),
        None => Ok(None),
    }
}

/// 覆盖指定日期的所有出现段：`start <= date AND (end IS NULL OR end >= date)`
pub fn list_covering(conn: &Connection, date: &str) -> AppResult<Vec<Occurrence>> {
    let sql = format!(
        "SELECT {COLUMNS} FROM occurrences \
         WHERE start_date <= ?1 AND (end_date IS NULL OR end_date >= ?1) \
         ORDER BY node_id, start_date"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![date], map_occurrence)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// 供可见性引擎使用：node_id → 覆盖该日期的出现段列表
pub fn covering_map(conn: &Connection, date: &str) -> AppResult<HashMap<String, Vec<Occurrence>>> {
    let mut map: HashMap<String, Vec<Occurrence>> = HashMap::new();
    for occ in list_covering(conn, date)? {
        map.entry(occ.node_id.clone()).or_default().push(occ);
    }
    Ok(map)
}

pub fn count_open(conn: &Connection, node_id: &str) -> AppResult<i64> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM occurrences WHERE node_id = ?1 AND end_date IS NULL",
        params![node_id],
        |r| r.get(0),
    )?)
}

/// 新增出现段。若同一节点同一开始日已存在出现段，则合并（幂等），避免撞唯一约束。
pub fn insert(conn: &Connection, input: &OccurrenceInput, now: &str) -> AppResult<Occurrence> {
    let source = input.source.unwrap_or(OccurrenceSource::Manual);
    let is_reappear = input.is_manual_reappear.unwrap_or(source == OccurrenceSource::Reappear);

    if let Some(existing) = find_by_start(conn, &input.node_id, &input.start_date)? {
        // 合并规则：结束日期取「更晚者」；新段为开放段则结果也为开放段
        let merged_end: Option<String> = match (&existing.end_date, &input.end_date) {
            (None, _) | (_, None) => None,
            (Some(a), Some(b)) => Some(if a >= b { a.clone() } else { b.clone() }),
        };
        conn.execute(
            "UPDATE occurrences SET end_date = ?2, source = ?3, is_manual_reappear = ?4, updated_at = ?5 \
             WHERE id = ?1",
            params![
                existing.id,
                merged_end,
                if source == OccurrenceSource::Auto { existing.source } else { source },
                is_reappear as i64,
                now
            ],
        )?;
        return get(conn, existing.id)?
            .ok_or_else(|| AppError::not_found("合并出现段后读取失败"));
    }

    conn.execute(
        "INSERT INTO occurrences (node_id, start_date, end_date, source, is_manual_reappear, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![
            input.node_id,
            input.start_date,
            input.end_date,
            source,
            is_reappear as i64,
            now
        ],
    )
    .map_err(|e| AppError::from_sqlite(e, "新增出现段失败"))?;

    let id = conn.last_insert_rowid();
    get(conn, id)?.ok_or_else(|| AppError::not_found("新增出现段后读取失败"))
}

pub fn find_by_start(
    conn: &Connection,
    node_id: &str,
    start_date: &str,
) -> AppResult<Option<Occurrence>> {
    let sql = format!("SELECT {COLUMNS} FROM occurrences WHERE node_id = ?1 AND start_date = ?2");
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query_map(params![node_id, start_date], map_occurrence)?;
    match rows.next() {
        Some(r) => Ok(Some(r?)),
        None => Ok(None),
    }
}

pub fn update(
    conn: &Connection,
    id: i64,
    start_date: &str,
    end_date: Option<&str>,
    source: OccurrenceSource,
    is_manual_reappear: bool,
    now: &str,
) -> AppResult<Occurrence> {
    let changed = conn
        .execute(
            "UPDATE occurrences SET start_date = ?2, end_date = ?3, source = ?4, \
             is_manual_reappear = ?5, updated_at = ?6 WHERE id = ?1",
            params![
                id,
                start_date,
                end_date,
                source,
                is_manual_reappear as i64,
                now
            ],
        )
        .map_err(|e| AppError::from_sqlite(e, "更新出现段失败"))?;
    if changed == 0 {
        return Err(AppError::not_found(format!("出现段 {id} 不存在")));
    }
    get(conn, id)?.ok_or_else(|| AppError::not_found(format!("出现段 {id} 不存在")))
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM occurrences WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn delete_by_node(conn: &Connection, node_id: &str) -> AppResult<usize> {
    Ok(conn.execute("DELETE FROM occurrences WHERE node_id = ?1", params![node_id])?)
}

/// 完成时截断：把所有开放段（end 为空）的结束日写为 `end_date`。
pub fn end_open_spans(conn: &Connection, node_id: &str, end_date: &str, now: &str) -> AppResult<usize> {
    Ok(conn.execute(
        "UPDATE occurrences SET end_date = ?2, updated_at = ?3 \
         WHERE node_id = ?1 AND end_date IS NULL AND start_date <= ?2",
        params![node_id, end_date, now],
    )?)
}

/// 反向操作：把「恰好结束于 end_date」的段恢复为开放段（已完成 → 重新激活）。
pub fn reopen_spans_ending(
    conn: &Connection,
    node_id: &str,
    end_date: &str,
    now: &str,
) -> AppResult<usize> {
    Ok(conn.execute(
        "UPDATE occurrences SET end_date = NULL, updated_at = ?3 \
         WHERE node_id = ?1 AND end_date = ?2",
        params![node_id, end_date, now],
    )?)
}

/// 新建节点时的起始出现段：
/// - 自动延续 → 开放段（end 为空），之后靠可见性动态延续，不物化每日出现段
/// - 手动 / 不延续 / 休眠后重现 → 仅覆盖创建日
pub fn ensure_initial(
    conn: &Connection,
    node_id: &str,
    date: &str,
    continuation: Continuation,
    now: &str,
) -> AppResult<()> {
    let existing: i64 = conn.query_row(
        "SELECT COUNT(*) FROM occurrences WHERE node_id = ?1",
        params![node_id],
        |r| r.get(0),
    )?;
    if existing > 0 {
        return Ok(());
    }
    let (end, source) = if continuation == Continuation::Auto {
        (None, OccurrenceSource::Auto)
    } else {
        (Some(date.to_string()), OccurrenceSource::Manual)
    };
    conn.execute(
        "INSERT INTO occurrences (node_id, start_date, end_date, source, is_manual_reappear, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5)",
        params![node_id, date, end, source, now],
    )
    .map_err(|e| AppError::from_sqlite(e, "创建起始出现段失败"))?;
    Ok(())
}
