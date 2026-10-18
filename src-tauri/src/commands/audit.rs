//! 操作记录辅助：把实体变更写进 `operations` 表（需求 6.5 / 4.7）。
//!
//! 只记录元数据与前后 JSON 快照，绝不写正文全文（正文版本在 content_revisions）。

use crate::error::AppResult;
use crate::repo::operations as op_repo;
use rusqlite::Connection;

/// 记录一条操作。`before` / `after` 传 JSON 字符串即可（内部不做解析）。
pub fn record(
    conn: &Connection,
    entity_type: &str,
    entity_id: &str,
    action: &str,
    before: Option<String>,
    after: Option<String>,
    batch_id: Option<&str>,
) -> AppResult<()> {
    op_repo::insert(
        conn,
        entity_type,
        entity_id,
        action,
        before.as_deref(),
        after.as_deref(),
        batch_id,
    )
}

/// 把任意可序列化对象转成操作记录用的 JSON 字符串。
pub fn json<T: serde::Serialize>(value: &T) -> Option<String> {
    serde_json::to_string(value).ok()
}
