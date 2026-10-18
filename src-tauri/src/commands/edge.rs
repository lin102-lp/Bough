//! 当天边命令：创建 / 删除 / 复制到明天（阶段 2 完整版）。

use crate::commands::day_view::{self, DayContext};
use crate::error::{AppError, AppResult};
use crate::models::{
    CopyEdgesRequest, CopyEdgesResult, DayEdge, EdgeInput, EdgeType, InvisibleEdgeInfo,
    NodeSummary, OccurrenceInput, OccurrenceSource,
};
use crate::repo;
use crate::state::AppState;
use crate::util;
use std::collections::HashMap;
use tauri::State;

#[tauri::command(async)]
pub fn list_day_edges(state: State<'_, AppState>, date: String) -> AppResult<Vec<DayEdge>> {
    let date = util::ensure_date(&date)?;
    let conn = state.lock();
    repo::edges::list_by_date(&conn, &date)
}

/// 创建当天边（内部只存 `single` / `point`；双向、多向都由多条边派生）。
pub fn create_edge_impl(state: &AppState, input: EdgeInput) -> AppResult<DayEdge> {
    let date = util::ensure_date(&input.date)?;
    if input.from_node_id == input.to_node_id {
        return Err(AppError::invalid("边的起点和终点不能是同一个节点"));
    }
    let kind = input.kind.unwrap_or(EdgeType::Single);
    let conn = state.lock();

    let from = repo::nodes::get_or_err(&conn, &input.from_node_id)?;
    let to = repo::nodes::get_or_err(&conn, &input.to_node_id)?;
    if from.deleted_at.is_some() || to.deleted_at.is_some() {
        return Err(AppError::invalid("边的端点节点已被删除"));
    }

    // 唯一约束：同一天、同起点、同终点、同类型只允许一条
    if repo::edges::find(&conn, &date, &from.id, &to.id, kind)?.is_some() {
        return Err(AppError::conflict(format!(
            "{date} 已存在「{}」→「{}」的同类边",
            from.title, to.title
        )));
    }

    let now = util::now_iso();
    let edge = DayEdge {
        id: input.id.unwrap_or_else(|| util::new_id("edge")),
        date,
        from_node_id: from.id,
        to_node_id: to.id,
        kind,
        group_id: input.group_id,
        copied_from_date: input.copied_from_date,
        batch_id: input.batch_id,
        created_at: now.clone(),
        updated_at: now,
        deleted_at: None,
    };
    repo::edges::insert(&conn, &edge)?;
    let _ = crate::commands::audit::record(
        &conn,
        "day_edge",
        &edge.id,
        "create",
        None,
        crate::commands::audit::json(&edge),
        edge.batch_id.as_deref(),
    );
    Ok(edge)
}

#[tauri::command(async)]
pub fn create_edge(state: State<'_, AppState>, input: EdgeInput) -> AppResult<DayEdge> {
    create_edge_impl(&state, input)
}

#[tauri::command(async)]
pub fn update_edge(state: State<'_, AppState>, input: EdgeInput) -> AppResult<DayEdge> {
    let conn = state.lock();
    repo::edges::update(&conn, &input, &util::now_iso())
}

#[tauri::command(async)]
pub fn delete_edge(state: State<'_, AppState>, edge_id: String) -> AppResult<()> {
    let conn = state.lock();
    let before = repo::edges::get(&conn, &edge_id)?;
    repo::edges::soft_delete(&conn, &edge_id, &util::now_iso())?;
    let _ = crate::commands::audit::record(
        &conn,
        "day_edge",
        &edge_id,
        "soft_delete",
        before.as_ref().and_then(|e| crate::commands::audit::json(e)),
        None,
        None,
    );
    Ok(())
}

#[tauri::command(async)]
pub fn delete_edges(state: State<'_, AppState>, edge_ids: Vec<String>) -> AppResult<usize> {
    let conn = state.lock();
    repo::edges::soft_delete_many(&conn, &edge_ids, &util::now_iso())
}

/// 按复制批次一键撤销（需求 4.2.4）。
#[tauri::command(async)]
pub fn delete_edge_batch(state: State<'_, AppState>, batch_id: String) -> AppResult<usize> {
    let conn = state.lock();
    repo::edges::soft_delete_batch(&conn, &batch_id, &util::now_iso())
}

/// 恢复整批被软删除的边（撤销「撤销复制」时使用）。
#[tauri::command(async)]
pub fn restore_edge_batch(state: State<'_, AppState>, batch_id: String) -> AppResult<usize> {
    let conn = state.lock();
    repo::edges::restore_batch(&conn, &batch_id, &util::now_iso())
}

/// 恢复单条被软删除的边（撤销「删除边」时使用）。
#[tauri::command(async)]
pub fn restore_edge(state: State<'_, AppState>, edge_id: String) -> AppResult<()> {
    let conn = state.lock();
    repo::edges::restore(&conn, &edge_id, &util::now_iso())?;
    Ok(())
}

/// 物理删除边：仅用于撤销「本次会话中新建的边」，让同一个 id 可以被重做再次插入。
#[tauri::command(async)]
pub fn purge_edge(state: State<'_, AppState>, edge_id: String) -> AppResult<()> {
    let conn = state.lock();
    repo::edges::purge(&conn, &edge_id)?;
    Ok(())
}

/// 复制边到明天（阶段 1 简化版，需求 4.2.8 的 1-5 步）：
///
/// 1. 取出源日期的边（可只复制选中的）
/// 2. 计算两端在**次日**是否可见
/// 3. 两端都可见 → 复制，标记 `copied_from_date` 与同一个 `batch_id`
/// 4. 任一端不可见 → 跳过并进入汇总列表（**不自动延续节点**）
/// 5. 目标日已存在同样的边 → 计入 `skipped_duplicate`
#[tauri::command(async)]
pub fn copy_edges_to_next_day(
    state: State<'_, AppState>,
    request: CopyEdgesRequest,
) -> AppResult<CopyEdgesResult> {
    let from_date = util::ensure_date(&request.from_date)?;
    let to_date = util::next_day(&from_date)?;
    let conn = state.lock();

    let all_edges = repo::edges::list_by_date(&conn, &from_date)?;
    let selected: Vec<DayEdge> = match request.edge_ids.as_ref() {
        Some(ids) if !ids.is_empty() => {
            let wanted: std::collections::HashSet<String> = ids.iter().cloned().collect();
            all_edges.into_iter().filter(|e| wanted.contains(&e.id)).collect()
        }
        _ => all_edges,
    };
    let total = selected.len();

    if total == 0 {
        return Ok(CopyEdgesResult {
            from_date,
            to_date,
            batch_id: None,
            total: 0,
            copied: Vec::new(),
            skipped_invisible: Vec::new(),
            skipped_duplicate: 0,
            continued_nodes: Vec::new(),
            continued_occurrence_ids: Vec::new(),
        });
    }

    // 次日上下文（可见性判定）
    let mut ctx: DayContext = day_view::load_day_context(&conn, &to_date)?;
    let endpoint_ids: Vec<String> = {
        let mut ids: Vec<String> = Vec::new();
        for e in &selected {
            if !ids.contains(&e.from_node_id) {
                ids.push(e.from_node_id.clone());
            }
            if !ids.contains(&e.to_node_id) {
                ids.push(e.to_node_id.clone());
            }
        }
        ids
    };
    let mut visibility = day_view::evaluate_many(&ctx, &endpoint_ids);

    let now = util::now_iso();
    let mut continued_nodes: Vec<NodeSummary> = Vec::new();
    let mut continued_occurrence_ids: Vec<i64> = Vec::new();

    // ---------- 阶段 2：批量延续端点不可见的边 ----------
    // 需求 4.2.8 第 6 步：用户选择「批量延续相关节点到次日」时，
    // 为这些端点补一个**仅覆盖次日**的出现段（source = manual），然后重新判定可见性。
    if request.continue_invisible.unwrap_or(false) {
        let mut to_continue: Vec<String> = Vec::new();
        for edge in &selected {
            for id in [&edge.from_node_id, &edge.to_node_id] {
                let visible = visibility.get(id).map(|v| v.visible).unwrap_or(false);
                if !visible && !to_continue.contains(id) {
                    to_continue.push(id.clone());
                }
            }
        }

        if !to_continue.is_empty() {
            for id in &to_continue {
                // 不存在或已删除的节点不处理
                match repo::nodes::get(&conn, id)? {
                    Some(node) if node.deleted_at.is_none() => {
                        let input = OccurrenceInput {
                            id: None,
                            node_id: id.clone(),
                            start_date: to_date.clone(),
                            end_date: Some(to_date.clone()),
                            source: Some(OccurrenceSource::Manual),
                            is_manual_reappear: Some(false),
                        };
                        let occ = repo::occurrences::insert(&conn, &input, &now)?;
                        continued_occurrence_ids.push(occ.id);
                        continued_nodes.push(NodeSummary::from(&node));
                    }
                    _ => {}
                }
            }
            // 重新载入上下文并重新判定
            ctx = day_view::load_day_context(&conn, &to_date)?;
            visibility = day_view::evaluate_many(&ctx, &endpoint_ids);
        }
    }

    let title_of = |id: &str| -> String {
        ctx.nodes
            .get(id)
            .map(|n| n.title.clone())
            .unwrap_or_else(|| id.to_string())
    };

    let batch_id = util::new_id("batch");
    let mut copied: Vec<DayEdge> = Vec::new();
    let mut skipped_invisible: Vec<InvisibleEdgeInfo> = Vec::new();
    let mut skipped_duplicate = 0usize;
    // 多向边分组：同一天内同一 group_id 的边复制后仍归为一组
    let mut group_map: HashMap<String, String> = HashMap::new();

    for edge in selected {
        let from_vis = visibility
            .get(&edge.from_node_id)
            .cloned()
            .unwrap_or_else(|| {
                crate::models::VisibilityResult::hidden(
                    crate::models::VisibilityReason::DefaultHidden,
                    7,
                    "节点不存在",
                )
            });
        let to_vis = visibility.get(&edge.to_node_id).cloned().unwrap_or_else(|| {
            crate::models::VisibilityResult::hidden(
                crate::models::VisibilityReason::DefaultHidden,
                7,
                "节点不存在",
            )
        });

        if !from_vis.visible || !to_vis.visible {
            skipped_invisible.push(InvisibleEdgeInfo {
                edge: edge.clone(),
                from_title: title_of(&edge.from_node_id),
                to_title: title_of(&edge.to_node_id),
                from_visible: from_vis.visible,
                to_visible: to_vis.visible,
                from_reason: from_vis.reason,
                to_reason: to_vis.reason,
            });
            continue;
        }

        let new_group_id = edge.group_id.as_ref().map(|g| {
            group_map
                .entry(g.clone())
                .or_insert_with(|| util::new_id("group"))
                .clone()
        });

        let new_edge = DayEdge {
            id: util::new_id("edge"),
            date: to_date.clone(),
            from_node_id: edge.from_node_id.clone(),
            to_node_id: edge.to_node_id.clone(),
            kind: edge.kind,
            group_id: new_group_id,
            copied_from_date: Some(from_date.clone()),
            batch_id: Some(batch_id.clone()),
            created_at: now.clone(),
            updated_at: now.clone(),
            deleted_at: None,
        };

        if repo::edges::insert_or_ignore(&conn, &new_edge)? {
            copied.push(new_edge);
        } else {
            skipped_duplicate += 1;
        }
    }

    if !continued_nodes.is_empty() || !skipped_invisible.is_empty() || !copied.is_empty() {
        let _ = crate::commands::audit::record(
            &conn,
            "day_edge",
            &from_date,
            "copy_to_next_day",
            None,
            None,
            Some(&batch_id),
        );
    }

    Ok(CopyEdgesResult {
        from_date,
        to_date,
        batch_id: if copied.is_empty() {
            None
        } else {
            Some(batch_id)
        },
        total,
        copied,
        skipped_invisible,
        skipped_duplicate,
        continued_nodes,
        continued_occurrence_ids,
    })
}
