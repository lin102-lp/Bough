//! Markdown 正文读写 + 正文版本（需求 4.6 / 4.7）。
//!
//! - 正文存文件：`<数据目录>/notes/<node_id>.md`
//! - 版本存数据库：`content_revisions`（每次保存一个版本，存全文）
//! - 当日覆盖正文镜像：`<数据目录>/overlays/<date>/<node_id>.md`（便于文件系统直读 / 导出）

use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::util;
use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};

/// 原子写：先写临时文件再 rename，避免崩溃导致半个文件。
fn atomic_write(path: &Path, content: &str) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("md.tmp");
    std::fs::write(&tmp, content.as_bytes())?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

pub fn node_content_path(state: &AppState, node_id: &str) -> PathBuf {
    state.notes_dir.join(format!("{node_id}.md"))
}

/// 读取节点正文；文件不存在返回空串（不是错误）。
pub fn read_node_content(state: &AppState, node_id: &str) -> AppResult<String> {
    let path = node_content_path(state, node_id);
    if !path.exists() {
        return Ok(String::new());
    }
    Ok(std::fs::read_to_string(path)?)
}

/// 正文预览（读文件前若干字节，用于节点卡片）。
pub fn read_node_preview(state: &AppState, node_id: &str, max_bytes: usize) -> String {
    let path = node_content_path(state, node_id);
    if !path.exists() {
        return String::new();
    }
    util::read_head(&path, max_bytes).unwrap_or_default()
}

/// 写入正文并记录版本，返回新版本号。
pub fn write_node_content(
    state: &AppState,
    conn: &Connection,
    node_id: &str,
    content: &str,
) -> AppResult<i64> {
    let path = node_content_path(state, node_id);
    atomic_write(&path, content)?;

    let now = util::now_iso();
    let next_rev: i64 = conn.query_row(
        "SELECT COALESCE(MAX(revision), 0) + 1 FROM content_revisions WHERE node_id = ?1",
        params![node_id],
        |r| r.get(0),
    )?;
    conn.execute(
        "INSERT INTO content_revisions (node_id, revision, content, is_diff, created_at) \
         VALUES (?1, ?2, ?3, 0, ?4)",
        params![node_id, next_rev, content, now],
    )?;

    let rel = crate::repo::node_repo::content_relative_path(node_id);
    conn.execute(
        "UPDATE nodes SET content_path = ?2, updated_at = ?3 WHERE id = ?1",
        params![node_id, rel, now],
    )?;

    Ok(next_rev)
}

/// 当日覆盖正文的 Markdown 镜像（best-effort：失败不影响主流程）。
pub fn mirror_overlay_content(state: &AppState, date: &str, node_id: &str, content: Option<&str>) {
    let dir = state.overlays_dir.join(date);
    let path = dir.join(format!("{node_id}.md"));
    let result = match content {
        Some(text) => atomic_write(&path, text),
        None => {
            if path.exists() {
                std::fs::remove_file(&path).map_err(AppError::from)
            } else {
                Ok(())
            }
        }
    };
    if let Err(e) = result {
        tracing::warn!("写入当日覆盖镜像失败（忽略）：{e}");
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentRevision {
    pub id: i64,
    pub node_id: String,
    pub revision: i64,
    pub content: Option<String>,
    pub is_diff: bool,
    pub created_at: String,
}

pub fn list_revisions(
    conn: &Connection,
    node_id: &str,
    limit: i64,
) -> AppResult<Vec<ContentRevision>> {
    let sql = format!(
        "SELECT id, node_id, revision, content, is_diff, created_at FROM content_revisions \
         WHERE node_id = ?1 ORDER BY revision DESC LIMIT {}",
        limit.clamp(1, 500)
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![node_id], |row| {
        Ok(ContentRevision {
            id: row.get(0)?,
            node_id: row.get(1)?,
            revision: row.get(2)?,
            content: row.get(3)?,
            is_diff: row.get(4)?,
            created_at: row.get(5)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}
