//! 节点表访问。

use crate::error::{AppError, AppResult};
use crate::models::{Node, NodeListFilter, NodeListItem, NodeStatus};
use crate::util;
use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, Row};

pub const COLUMNS: &str = "id, title, content_path, starred, status, completed_at, continuation, \
                           parent_id, created_at, updated_at, deleted_at";

pub fn map_node(row: &Row<'_>) -> rusqlite::Result<Node> {
    Ok(Node {
        id: row.get("id")?,
        title: row.get("title")?,
        content_path: row.get("content_path")?,
        starred: row.get("starred")?,
        status: row.get("status")?,
        completed_at: row.get("completed_at")?,
        continuation: row.get("continuation")?,
        parent_id: row.get("parent_id")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        deleted_at: row.get("deleted_at")?,
    })
}

pub fn list_all(conn: &Connection, include_deleted: bool) -> AppResult<Vec<Node>> {
    let sql = if include_deleted {
        format!("SELECT {COLUMNS} FROM nodes ORDER BY created_at ASC")
    } else {
        format!("SELECT {COLUMNS} FROM nodes WHERE deleted_at IS NULL ORDER BY created_at ASC")
    };
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], map_node)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// 一次性载入为 HashMap，供可见性引擎使用。
pub fn map_all(conn: &Connection, include_deleted: bool) -> AppResult<std::collections::HashMap<String, Node>> {
    Ok(list_all(conn, include_deleted)?
        .into_iter()
        .map(|n| (n.id.clone(), n))
        .collect())
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Option<Node>> {
    let sql = format!("SELECT {COLUMNS} FROM nodes WHERE id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query_map(params![id], map_node)?;
    match rows.next() {
        Some(r) => Ok(Some(r?)),
        None => Ok(None),
    }
}

pub fn get_or_err(conn: &Connection, id: &str) -> AppResult<Node> {
    get(conn, id)?.ok_or_else(|| AppError::not_found(format!("节点 {id} 不存在")))
}

pub fn insert(conn: &Connection, node: &Node) -> AppResult<()> {
    conn.execute(
        "INSERT INTO nodes (id, title, content_path, starred, status, completed_at, continuation, \
         parent_id, created_at, updated_at, deleted_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            node.id,
            node.title,
            node.content_path,
            node.starred as i64,
            node.status,
            node.completed_at,
            node.continuation,
            node.parent_id,
            node.created_at,
            node.updated_at,
            node.deleted_at,
        ],
    )
    .map_err(|e| AppError::from_sqlite(e, "创建节点失败"))?;
    Ok(())
}

pub fn update(conn: &Connection, node: &Node) -> AppResult<()> {
    let changed = conn.execute(
        "UPDATE nodes SET title = ?2, content_path = ?3, starred = ?4, status = ?5, \
         completed_at = ?6, continuation = ?7, parent_id = ?8, updated_at = ?9, deleted_at = ?10 \
         WHERE id = ?1",
        params![
            node.id,
            node.title,
            node.content_path,
            node.starred as i64,
            node.status,
            node.completed_at,
            node.continuation,
            node.parent_id,
            node.updated_at,
            node.deleted_at,
        ],
    )
    .map_err(|e| AppError::from_sqlite(e, "更新节点失败"))?;
    if changed == 0 {
        return Err(AppError::not_found(format!("节点 {} 不存在", node.id)));
    }
    Ok(())
}

/// 局部字段更新（避免读-改-写整行）。
pub fn patch(
    conn: &Connection,
    id: &str,
    title: Option<&str>,
    starred: Option<bool>,
    status: Option<NodeStatus>,
    completed_at: Option<Option<&str>>,
    continuation: Option<crate::models::Continuation>,
    parent_id: Option<Option<&str>>,
    now: &str,
) -> AppResult<()> {
    let mut sets: Vec<String> = vec!["updated_at = ?".into()];
    let mut args: Vec<Value> = vec![Value::Text(now.to_string())];

    if let Some(t) = title {
        sets.push("title = ?".into());
        args.push(Value::Text(t.to_string()));
    }
    if let Some(s) = starred {
        sets.push("starred = ?".into());
        args.push(Value::Integer(s as i64));
    }
    if let Some(s) = status {
        sets.push("status = ?".into());
        args.push(Value::Text(s.as_str().to_string()));
    }
    if let Some(c) = completed_at {
        sets.push("completed_at = ?".into());
        args.push(match c {
            Some(v) => Value::Text(v.to_string()),
            None => Value::Null,
        });
    }
    if let Some(c) = continuation {
        sets.push("continuation = ?".into());
        args.push(Value::Text(c.as_str().to_string()));
    }
    if let Some(p) = parent_id {
        sets.push("parent_id = ?".into());
        args.push(match p {
            Some(v) => Value::Text(v.to_string()),
            None => Value::Null,
        });
    }

    let sql = format!("UPDATE nodes SET {} WHERE id = ?", sets.join(", "));
    args.push(Value::Text(id.to_string()));
    let changed = conn.execute(&sql, params_from_iter(args))?;
    if changed == 0 {
        return Err(AppError::not_found(format!("节点 {id} 不存在")));
    }
    Ok(())
}

pub fn soft_delete(conn: &Connection, id: &str, now: &str) -> AppResult<()> {
    let changed = conn.execute(
        "UPDATE nodes SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1",
        params![id, now],
    )?;
    if changed == 0 {
        return Err(AppError::not_found(format!("节点 {id} 不存在")));
    }
    Ok(())
}

pub fn restore(conn: &Connection, id: &str, now: &str) -> AppResult<()> {
    let changed = conn.execute(
        "UPDATE nodes SET deleted_at = NULL, updated_at = ?2 WHERE id = ?1",
        params![id, now],
    )?;
    if changed == 0 {
        return Err(AppError::not_found(format!("节点 {id} 不存在")));
    }
    Ok(())
}

/// 物理删除（仅用于撤销「会话内新建节点」，级联清理出现段 / 布局 / 覆盖 / 边）。
pub fn purge(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute("DELETE FROM nodes WHERE id = ?1", params![id])?;
    Ok(())
}

/// 直接子节点。
pub fn children(conn: &Connection, parent_id: &str) -> AppResult<Vec<Node>> {
    let sql = format!(
        "SELECT {COLUMNS} FROM nodes WHERE parent_id = ?1 AND deleted_at IS NULL ORDER BY created_at ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![parent_id], map_node)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// 判断 `maybe_ancestor` 是否是 `node_id` 的祖先（用于禁止把父节点设成自己的后代）。
pub fn is_ancestor(conn: &Connection, node_id: &str, maybe_ancestor: &str) -> AppResult<bool> {
    let mut current = Some(node_id.to_string());
    let mut visited = std::collections::HashSet::new();
    while let Some(id) = current {
        if !visited.insert(id.clone()) {
            break; // 已有环，直接退出
        }
        let parent: Option<Option<String>> = conn
            .query_row("SELECT parent_id FROM nodes WHERE id = ?1", params![id], |row| {
                row.get(0)
            })
            .ok();
        match parent.flatten() {
            Some(p) => {
                if p == maybe_ancestor {
                    return Ok(true);
                }
                current = Some(p);
            }
            None => break,
        }
    }
    Ok(false)
}

fn base_item_sql() -> String {
    format!(
        "SELECT {cols_joined}, \
         (SELECT COUNT(*) FROM occurrences o WHERE o.node_id = n.id) AS occurrence_count, \
         (SELECT MIN(o.start_date) FROM occurrences o WHERE o.node_id = n.id) AS first_date, \
         (SELECT MAX(COALESCE(o.end_date, o.start_date)) FROM occurrences o WHERE o.node_id = n.id) AS last_date, \
         (SELECT COUNT(*) FROM occurrences o WHERE o.node_id = n.id AND o.end_date IS NULL) AS open_count, \
         (SELECT COUNT(*) FROM day_edges e WHERE (e.from_node_id = n.id OR e.to_node_id = n.id) AND e.deleted_at IS NULL) AS edge_count \
         FROM nodes n",
        cols_joined = COLUMNS
            .split(',')
            .map(|c| format!("n.{}", c.trim()))
            .collect::<Vec<_>>()
            .join(", ")
    )
}

fn map_item(row: &Row<'_>) -> rusqlite::Result<NodeListItem> {
    // 注意：聚合子查询列名与节点列名不冲突，可直接按名取
    let node = Node {
        id: row.get("id")?,
        title: row.get("title")?,
        content_path: row.get("content_path")?,
        starred: row.get("starred")?,
        status: row.get("status")?,
        completed_at: row.get("completed_at")?,
        continuation: row.get("continuation")?,
        parent_id: row.get("parent_id")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        deleted_at: row.get("deleted_at")?,
    };
    let open_count: i64 = row.get("open_count")?;
    Ok(NodeListItem {
        node,
        occurrence_count: row.get("occurrence_count")?,
        first_date: row.get("first_date")?,
        last_date: row.get("last_date")?,
        has_open_span: open_count > 0,
        edge_count: row.get("edge_count")?,
    })
}

pub fn list_items(conn: &Connection, filter: &NodeListFilter) -> AppResult<Vec<NodeListItem>> {
    let include_deleted = filter.include_deleted.unwrap_or(false);
    let mut clauses: Vec<String> = Vec::new();
    let mut args: Vec<Value> = Vec::new();

    if !include_deleted {
        clauses.push("n.deleted_at IS NULL".into());
    }
    if filter.starred_only.unwrap_or(false) {
        clauses.push("n.starred = 1".into());
    }
    if let Some(kw) = filter.keyword.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        clauses.push("n.title LIKE ?".into());
        args.push(Value::Text(format!("%{kw}%")));
    }
    if let Some(statuses) = filter.statuses.as_ref().filter(|v| !v.is_empty()) {
        let placeholders = vec!["?"; statuses.len()].join(", ");
        clauses.push(format!("n.status IN ({placeholders})"));
        for s in statuses {
            args.push(Value::Text(s.as_str().to_string()));
        }
    }

    let mut sql = base_item_sql();
    if !clauses.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&clauses.join(" AND "));
    }
    sql.push_str(" ORDER BY n.updated_at DESC");
    let limit = filter.limit.unwrap_or(500).clamp(1, 5000);
    sql.push_str(&format!(" LIMIT {limit}"));

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(args), map_item)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// 搜索：标题 + 当日覆盖标题（正文检索在阶段 3 用索引实现）。
pub fn search(conn: &Connection, keyword: &str, limit: i64) -> AppResult<Vec<NodeListItem>> {
    let kw = keyword.trim();
    if kw.is_empty() {
        return Ok(Vec::new());
    }
    let like = format!("%{kw}%");
    let sql = format!(
        "{} WHERE n.deleted_at IS NULL AND (n.title LIKE ?1 OR EXISTS (\
            SELECT 1 FROM day_overlays ov WHERE ov.node_id = n.id AND ov.title LIKE ?1\
         )) ORDER BY n.updated_at DESC LIMIT {}",
        base_item_sql(),
        limit.clamp(1, 500)
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![like], map_item)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn count(conn: &Connection) -> AppResult<i64> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM nodes WHERE deleted_at IS NULL",
        [],
        |r| r.get(0),
    )?)
}

/// 取节点正文文件相对路径（用于 content_path 字段）。
pub fn content_relative_path(node_id: &str) -> String {
    format!("notes/{node_id}.md")
}

pub fn touch(conn: &Connection, id: &str, now: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE nodes SET updated_at = ?2 WHERE id = ?1",
        params![id, now],
    )?;
    Ok(())
}

pub fn now_touch(conn: &Connection, id: &str) -> AppResult<String> {
    let now = util::now_iso();
    touch(conn, id, &now)?;
    Ok(now)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn test_conn() -> Connection {
        let mut conn = Connection::open_in_memory().expect("in-memory db");
        db::configure(&conn).expect("configure");
        db::migrations::run(&mut conn).expect("migrations");
        conn
    }

    /// 回归测试：左侧列表 / 搜索的 SQL 必须能真实执行。
    ///
    /// 历史缺陷：`base_item_sql` 在已经带 `n.` 前缀的列名前又拼了一次 `n.`，
    /// 生成 `n.n.id`，导致 `list_nodes`、`search_nodes` 全部报
    /// 「no such column: n.n.id」。
    #[test]
    fn list_items_and_search_build_valid_sql() {
        let conn = test_conn();
        conn.execute(
            "INSERT INTO nodes (id, title, content_path, starred, status, continuation, created_at, updated_at) \
             VALUES ('n1', '测试节点', 'notes/n1.md', 0, 'doing', 'auto', \
                     '2026-10-18T00:00:00+08:00', '2026-10-18T00:00:00+08:00')",
            [],
        )
        .expect("insert node");

        let items = list_items(&conn, &NodeListFilter::default()).expect("list_items");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].node.id, "n1");
        assert_eq!(items[0].node.title, "测试节点");
        assert_eq!(items[0].occurrence_count, 0);
        assert!(!items[0].has_open_span);
        assert_eq!(items[0].edge_count, 0);

        let found = search(&conn, "测试", 10).expect("search");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].node.id, "n1");
    }
}
