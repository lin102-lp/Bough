//! 操作记录表访问（需求 6.5 / 4.7）。
//!
//! 只存元数据与前后快照（JSON），**不存正文全文**——正文版本在 content_revisions。

use crate::error::{AppError, AppResult};
use crate::models_stage2::{OperationFilter, OperationRecord};
use crate::util;
use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, Row};

pub const COLUMNS: &str = "id, entity_type, entity_id, action, before_json, after_json, \
                            diff_ref, batch_id, created_at";

pub fn map_row(row: &Row<'_>) -> rusqlite::Result<OperationRecord> {
    Ok(OperationRecord {
        id: row.get("id")?,
        entity_type: row.get("entity_type")?,
        entity_id: row.get("entity_id")?,
        action: row.get("action")?,
        before_json: row.get("before_json")?,
        after_json: row.get("after_json")?,
        diff_ref: row.get("diff_ref")?,
        batch_id: row.get("batch_id")?,
        created_at: row.get("created_at")?,
    })
}

/// 写一条操作记录。
pub fn insert(
    conn: &Connection,
    entity_type: &str,
    entity_id: &str,
    action: &str,
    before: Option<&str>,
    after: Option<&str>,
    batch_id: Option<&str>,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO operations (id, entity_type, entity_id, action, before_json, after_json, \
         diff_ref, batch_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?8)",
        params![
            util::new_id("op"),
            entity_type,
            entity_id,
            action,
            before,
            after,
            batch_id,
            util::now_iso()
        ],
    )
    .map_err(|e| AppError::from_sqlite(e, "写入操作记录失败"))?;
    Ok(())
}

pub fn list(conn: &Connection, filter: &OperationFilter) -> AppResult<Vec<OperationRecord>> {
    let mut clauses: Vec<String> = Vec::new();
    let mut args: Vec<Value> = Vec::new();

    if let Some(t) = filter.entity_type.as_deref().filter(|s| !s.is_empty()) {
        clauses.push("entity_type = ?".into());
        args.push(Value::Text(t.to_string()));
    }
    if let Some(id) = filter.entity_id.as_deref().filter(|s| !s.is_empty()) {
        clauses.push("entity_id = ?".into());
        args.push(Value::Text(id.to_string()));
    }
    if let Some(b) = filter.batch_id.as_deref().filter(|s| !s.is_empty()) {
        clauses.push("batch_id = ?".into());
        args.push(Value::Text(b.to_string()));
    }

    let mut sql = format!("SELECT {COLUMNS} FROM operations");
    if !clauses.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&clauses.join(" AND "));
    }
    sql.push_str(" ORDER BY created_at DESC, rowid DESC");
    let limit = filter.limit.unwrap_or(200).clamp(1, 2000);
    sql.push_str(&format!(" LIMIT {limit}"));

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(args), map_row)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn count(conn: &Connection) -> AppResult<i64> {
    Ok(conn.query_row("SELECT COUNT(*) FROM operations", [], |r| r.get(0))?)
}

/// 只保留最近 `keep` 条（防止操作记录无限增长）。
pub fn trim(conn: &Connection, keep: i64) -> AppResult<usize> {
    Ok(conn.execute(
        "DELETE FROM operations WHERE id NOT IN (\
            SELECT id FROM operations ORDER BY created_at DESC, rowid DESC LIMIT ?1\
         )",
        params![keep.max(1)],
    )?)
}
