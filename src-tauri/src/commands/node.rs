//! 节点相关命令：创建 / 更新 / 状态 / 删除 / 正文。

use crate::commands::audit;
use crate::content;
use crate::error::{AppError, AppResult};
use crate::models::{
    Continuation, Node, NodeInput, NodeListFilter, NodeListItem, NodeStatus,
};
use crate::repo;
use crate::state::AppState;
use crate::util;
use rusqlite::Connection;
use std::collections::HashMap;
use tauri::State;

/// 读取设置里的默认延续策略（需求 4.1.1）。
pub fn default_continuation(conn: &Connection) -> Continuation {
    repo::settings::get(conn, repo::settings::keys::DEFAULT_CONTINUATION)
        .ok()
        .flatten()
        .and_then(|v| Continuation::parse(v.trim()))
        .unwrap_or(Continuation::Auto)
}

fn normalize_title(raw: &str) -> String {
    let t = raw.trim();
    if t.is_empty() {
        "未命名节点".to_string()
    } else {
        t.to_string()
    }
}

/// 保存节点（`input.id` 存在且库中已有 → 全量更新；否则新建）。
///
/// 关键副作用：
/// - 新建时按延续策略生成起始出现段（自动延续 → 开放段；其余 → 仅创建日）
/// - 状态变为「已完成」时截断活跃出现段（需求 4.1.10）
/// - 已完成改回未完成时重新打开被截断的段（需求 4.1.9：已完成可手动重新激活）
/// - 提供了 `content` 时写入 Markdown 并记录 `content_revisions`
pub fn save_node_impl(state: &AppState, input: NodeInput) -> AppResult<Node> {
    let on_date = match input.on_date.as_deref() {
        Some(d) => util::ensure_date(d)?,
        None => util::today_str(),
    };
    let title = normalize_title(&input.title);

    let conn = state.lock();
    let now = util::now_iso();

    // ---------- 父节点合法性校验（需求 11：禁止形成环） ----------
    if let Some(parent_id) = input.parent_id.clone() {
        if input.id.as_deref() == Some(parent_id.as_str()) {
            return Err(AppError::invalid("父节点不能是节点自身"));
        }
        match repo::nodes::get(&conn, &parent_id)? {
            None => return Err(AppError::invalid(format!("父节点 {parent_id} 不存在"))),
            Some(p) if p.deleted_at.is_some() => {
                return Err(AppError::invalid("父节点已被删除，无法建立父子关系"))
            }
            _ => {}
        }
        if let Some(id) = input.id.as_deref() {
            if repo::nodes::is_ancestor(&conn, &parent_id, id)? {
                return Err(AppError::invalid("父节点不能是自己的后代，否则会形成环"));
            }
        }
    }

    let existing = match input.id.as_deref() {
        Some(id) => repo::nodes::get(&conn, id)?,
        None => None,
    };
    let existed_before = existing.is_some();
    let before_json = existing.as_ref().and_then(|n| audit::json(n));

    let node = match existing {
        Some(old) => {
            let status = input.status.unwrap_or(old.status);
            let continuation = input.continuation.unwrap_or(old.continuation);

            let completed_at = if status == NodeStatus::Done {
                if old.status == NodeStatus::Done {
                    old.completed_at.clone()
                } else {
                    Some(now.clone())
                }
            } else {
                None
            };

            // 完成 → 截断当前活跃出现段的结束日期为完成日
            if status == NodeStatus::Done && old.status != NodeStatus::Done {
                repo::occurrences::end_open_spans(&conn, &old.id, &on_date, &now)?;
            }
            // 反悔：已完成 → 未完成，恢复被截断的开放段
            if status != NodeStatus::Done && old.status == NodeStatus::Done {
                if let Some(done_date) = old.completed_at.as_deref().and_then(util::iso_to_date) {
                    repo::occurrences::reopen_spans_ending(&conn, &old.id, &done_date, &now)?;
                }
            }

            let updated = Node {
                id: old.id.clone(),
                title,
                content_path: old.content_path.clone(),
                starred: input.starred.unwrap_or(old.starred),
                status,
                completed_at,
                continuation,
                parent_id: input.parent_id.clone(),
                created_at: old.created_at.clone(),
                updated_at: now.clone(),
                deleted_at: old.deleted_at.clone(),
            };
            repo::nodes::update(&conn, &updated)?;
            updated
        }
        None => {
            let id = input
                .id
                .clone()
                .unwrap_or_else(|| util::new_id("node"));
            let status = input.status.unwrap_or(NodeStatus::Todo);
            let continuation = input.continuation.unwrap_or_else(|| default_continuation(&conn));
            let created = Node {
                id: id.clone(),
                title,
                content_path: Some(repo::node_repo::content_relative_path(&id)),
                starred: input.starred.unwrap_or(false),
                status,
                completed_at: if status == NodeStatus::Done {
                    Some(now.clone())
                } else {
                    None
                },
                continuation,
                parent_id: input.parent_id.clone(),
                created_at: now.clone(),
                updated_at: now.clone(),
                deleted_at: None,
            };
            repo::nodes::insert(&conn, &created)?;
            repo::occurrences::ensure_initial(&conn, &id, &on_date, continuation, &now)?;
            created
        }
    };

    if let Some(text) = input.content.as_ref() {
        content::write_node_content(state, &conn, &node.id, text)?;
    }

    // 操作记录（需求 4.7）：只存元数据与前后 JSON，正文版本在 content_revisions
    let _ = audit::record(
        &conn,
        "node",
        &node.id,
        if existed_before { "update" } else { "create" },
        before_json,
        audit::json(&node),
        None,
    );

    Ok(node)
}

#[tauri::command(async)]
pub fn save_node(state: State<'_, AppState>, input: NodeInput) -> AppResult<Node> {
    save_node_impl(&state, input)
}

#[tauri::command(async)]
pub fn get_node(state: State<'_, AppState>, node_id: String) -> AppResult<Node> {
    let conn = state.lock();
    repo::nodes::get_or_err(&conn, &node_id)
}

/// 左侧面板 / 筛选器用的节点列表。
#[tauri::command(async)]
pub fn list_nodes(
    state: State<'_, AppState>,
    filter: Option<NodeListFilter>,
) -> AppResult<Vec<NodeListItem>> {
    let conn = state.lock();
    repo::nodes::list_items(&conn, &filter.unwrap_or_default())
}

/// 标题搜索（正文检索留到阶段 3 建索引）。
#[tauri::command(async)]
pub fn search_nodes(
    state: State<'_, AppState>,
    keyword: String,
    limit: Option<i64>,
) -> AppResult<Vec<NodeListItem>> {
    let conn = state.lock();
    repo::nodes::search(&conn, &keyword, limit.unwrap_or(50))
}

/// 快速切换状态（节点卡片上的按钮走这里，不必提交整份表单）。
#[tauri::command(async)]
pub fn set_node_status(
    state: State<'_, AppState>,
    node_id: String,
    status: NodeStatus,
    on_date: Option<String>,
) -> AppResult<Node> {
    let date = match on_date.as_deref() {
        Some(d) => util::ensure_date(d)?,
        None => util::today_str(),
    };
    let conn = state.lock();
    let now = util::now_iso();
    let old = repo::nodes::get_or_err(&conn, &node_id)?;
    if old.status == status {
        return Ok(old);
    }

    let completed_at = if status == NodeStatus::Done {
        Some(now.clone())
    } else {
        None
    };

    if status == NodeStatus::Done {
        repo::occurrences::end_open_spans(&conn, &node_id, &date, &now)?;
    } else if old.status == NodeStatus::Done {
        if let Some(done_date) = old.completed_at.as_deref().and_then(util::iso_to_date) {
            repo::occurrences::reopen_spans_ending(&conn, &node_id, &done_date, &now)?;
        }
    }

    repo::nodes::patch(
        &conn,
        &node_id,
        None,
        None,
        Some(status),
        Some(completed_at.as_deref()),
        None,
        None,
        &now,
    )?;

    repo::nodes::get_or_err(&conn, &node_id)
}

/// 软删除（可在回收站恢复，历史数据保留）。
#[tauri::command(async)]
pub fn delete_node(state: State<'_, AppState>, node_id: String) -> AppResult<()> {
    let conn = state.lock();
    let before = repo::nodes::get(&conn, &node_id)?;
    repo::nodes::soft_delete(&conn, &node_id, &util::now_iso())?;
    let _ = audit::record(
        &conn,
        "node",
        &node_id,
        "soft_delete",
        before.as_ref().and_then(|n| audit::json(n)),
        None,
        None,
    );
    Ok(())
}

#[tauri::command(async)]
pub fn restore_node(state: State<'_, AppState>, node_id: String) -> AppResult<()> {
    let conn = state.lock();
    repo::nodes::restore(&conn, &node_id, &util::now_iso())
}

/// 物理删除：仅用于撤销「本次会话中新建的节点」（级联清理出现段 / 布局 / 覆盖 / 边）。
#[tauri::command(async)]
pub fn purge_node(state: State<'_, AppState>, node_id: String) -> AppResult<()> {
    let conn = state.lock();
    repo::nodes::purge(&conn, &node_id)?;
    drop(conn);
    // 顺手清理正文文件，避免残留孤儿 Markdown
    let path = content::node_content_path(&state, &node_id);
    if path.exists() {
        if let Err(e) = std::fs::remove_file(&path) {
            tracing::warn!("删除正文文件失败（忽略）：{e}");
        }
    }
    Ok(())
}

/// 读取节点正文（Markdown 文件全文）。
#[tauri::command(async)]
pub fn get_node_content(state: State<'_, AppState>, node_id: String) -> AppResult<String> {
    content::read_node_content(&state, &node_id)
}

/// 保存节点正文，返回新的正文版本号。
#[tauri::command(async)]
pub fn save_node_content(
    state: State<'_, AppState>,
    node_id: String,
    content_text: String,
) -> AppResult<i64> {
    let conn = state.lock();
    repo::nodes::get_or_err(&conn, &node_id)?;
    content::write_node_content(&state, &conn, &node_id, &content_text)
}

/// 批量取正文预览（供画布节点卡片显示），一次 IPC 顶多次调用。
///
/// 传了 `date` 时优先返回当天的覆盖正文。
#[tauri::command(async)]
pub fn get_node_previews(
    state: State<'_, AppState>,
    node_ids: Vec<String>,
    date: Option<String>,
    max_chars: Option<usize>,
) -> AppResult<HashMap<String, String>> {
    let limit = max_chars.unwrap_or(140).clamp(10, 2000);
    let date = match date.as_deref() {
        Some(d) => Some(util::ensure_date(d)?),
        None => None,
    };
    let conn = state.lock();
    let mut out = HashMap::new();

    for id in node_ids {
        if let Some(d) = date.as_deref() {
            if let Some(overlay) = repo::overlays::get(&conn, &id, d)? {
                if let Some(text) = overlay.content.filter(|c| !c.is_empty()) {
                    out.insert(id, util::truncate_chars(text.trim(), limit));
                    continue;
                }
            }
        }
        let raw = content::read_node_preview(&state, &id, 1024);
        out.insert(id, util::truncate_chars(raw.trim(), limit));
    }

    Ok(out)
}
