//! 日期视图：把「节点全局 + 当天数据」组装成前端可直接渲染的结构。
//!
//! 这是可见性引擎的唯一入口，复制边、时间树都复用它来判断端点可见性。

use crate::error::AppResult;
use crate::models::{
    DayEdge, DayEdgeView, DayNode, DayStats, DayView, DayOverlay, FollowMode, HiddenNode, Node,
    NodeStatus, Occurrence, VisibilityOptions, VisibilityResult,
};
use crate::repo;
use crate::state::AppState;
use crate::util;
use crate::visibility::VisibilityContext;
use rusqlite::Connection;
use std::collections::{HashMap, HashSet};
use tauri::State;

/// 一次日期视图查询所需的全部上下文（构建一次，多处复用）。
pub struct DayContext {
    pub date: String,
    pub nodes: HashMap<String, Node>,
    pub overlays: HashMap<String, DayOverlay>,
    pub coverings: HashMap<String, Vec<Occurrence>>,
    pub follow: HashMap<String, FollowMode>,
    pub options: VisibilityOptions,
}

/// 载入某一天的全部判定依据（4 次查询，避免 N+1）。
pub fn load_day_context(conn: &Connection, date: &str) -> AppResult<DayContext> {
    Ok(DayContext {
        date: date.to_string(),
        nodes: repo::nodes::map_all(conn, true)?,
        overlays: repo::overlays::map_by_date(conn, date)?,
        coverings: repo::occurrences::covering_map(conn, date)?,
        // 阶段 2：只取在该日期生效的跟随覆盖（支持区间）
        follow: repo::follows::map_active(conn, date)?,
        options: repo::settings::visibility_options(conn),
    })
}

/// 对单个节点做可见性判定（复制边时会批量调用）。
pub fn evaluate_node(ctx: &DayContext, node_id: &str) -> VisibilityResult {
    let mut engine = VisibilityContext::new(
        &ctx.date,
        &ctx.nodes,
        &ctx.overlays,
        &ctx.coverings,
        &ctx.follow,
        ctx.options,
    );
    engine.evaluate(node_id)
}

/// 批量判定。
pub fn evaluate_many(ctx: &DayContext, ids: &[String]) -> HashMap<String, VisibilityResult> {
    let mut engine = VisibilityContext::new(
        &ctx.date,
        &ctx.nodes,
        &ctx.overlays,
        &ctx.coverings,
        &ctx.follow,
        ctx.options,
    );
    engine.evaluate_all(ids)
}

/// 获取日期视图。
#[tauri::command(async)]
pub fn get_day_view(
    state: State<'_, AppState>,
    date: String,
    include_hidden: Option<bool>,
) -> AppResult<DayView> {
    let date = util::ensure_date(&date)?;
    let include_hidden = include_hidden.unwrap_or(true);
    let conn = state.lock();
    build_day_view(&conn, &date, include_hidden)
}

/// 纯函数版本，便于被其他命令复用。
pub fn build_day_view(conn: &Connection, date: &str, include_hidden: bool) -> AppResult<DayView> {
    let ctx = load_day_context(conn, date)?;

    let mut engine = VisibilityContext::new(
        date,
        &ctx.nodes,
        &ctx.overlays,
        &ctx.coverings,
        &ctx.follow,
        ctx.options,
    );

    let mut candidates: Vec<Node> = ctx
        .nodes
        .values()
        .filter(|n| n.deleted_at.is_none())
        .cloned()
        .collect();
    // 稳定顺序：创建时间升序，其次标题
    candidates.sort_by(|a, b| {
        a.created_at
            .cmp(&b.created_at)
            .then_with(|| a.title.cmp(&b.title))
    });

    let candidate_count = candidates.len();
    let mut nodes: Vec<DayNode> = Vec::new();
    let mut hidden: Vec<HiddenNode> = Vec::new();

    for node in candidates {
        let visibility = engine.evaluate(&node.id);
        if !visibility.visible {
            if include_hidden {
                hidden.push(HiddenNode {
                    node: node.clone(),
                    visibility,
                });
            }
            continue;
        }

        let overlay = ctx.overlays.get(&node.id).cloned();
        let display_title = overlay
            .as_ref()
            .and_then(|o| o.title.clone())
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .unwrap_or_else(|| node.title.clone());

        let occurrence = visibility.occurrence_id.and_then(|oid| {
            ctx.coverings
                .get(&node.id)
                .and_then(|list| list.iter().find(|o| o.id == oid))
                .cloned()
        });
        let continued_from = occurrence.as_ref().map(|o| o.start_date.clone());
        let day_index = occurrence
            .as_ref()
            .and_then(|o| util::diff_days(&o.start_date, date).ok())
            .map(|d| d + 1);

        let has_overlay_content = overlay
            .as_ref()
            .map(|o| o.content.as_ref().is_some_and(|c| !c.is_empty()))
            .unwrap_or(false);
        let overlay_content_preview = overlay
            .as_ref()
            .and_then(|o| o.content.as_ref())
            .filter(|c| !c.is_empty())
            .map(|c| util::truncate_chars(c, 140));

        nodes.push(DayNode {
            node,
            display_title,
            overlay,
            has_overlay_content,
            overlay_content_preview,
            visibility,
            occurrence,
            continued_from,
            day_index,
        });
    }

    // 可见节点排序：星标优先，其次更新时间倒序
    nodes.sort_by(|a, b| {
        b.node
            .starred
            .cmp(&a.node.starred)
            .then_with(|| b.node.updated_at.cmp(&a.node.updated_at))
    });

    let edges = repo::edges::list_by_date(conn, date)?;
    let visible_ids: HashSet<&str> = nodes.iter().map(|n| n.node.id.as_str()).collect();
    let pairs: HashSet<(String, String)> = edges
        .iter()
        .map(|e| (e.from_node_id.clone(), e.to_node_id.clone()))
        .collect();
    let edge_views: Vec<DayEdgeView> = edges
        .iter()
        .map(|e| edge_to_view(e, &pairs, &visible_ids))
        .collect();

    let layouts = repo::layouts::list_by_date(conn, date)?;

    let stats = DayStats {
        candidate_nodes: candidate_count,
        visible: nodes.len(),
        hidden: hidden.len(),
        edges: edge_views.len(),
        layouts: layouts.len(),
    };

    Ok(DayView {
        date: date.to_string(),
        is_today: date == util::today_str(),
        nodes,
        hidden,
        edges: edge_views,
        layouts,
        stats,
        options: ctx.options,
        generated_at: util::now_iso(),
    })
}

pub fn edge_to_view(
    edge: &DayEdge,
    pairs: &HashSet<(String, String)>,
    visible_ids: &HashSet<&str>,
) -> DayEdgeView {
    DayEdgeView {
        edge: edge.clone(),
        from_visible: visible_ids.contains(edge.from_node_id.as_str()),
        to_visible: visible_ids.contains(edge.to_node_id.as_str()),
        bidirectional: pairs.contains(&(edge.to_node_id.clone(), edge.from_node_id.clone())),
    }
}

/// 便捷：当天可见节点 ID（时间树 / 统计用）。
pub fn visible_node_ids(conn: &Connection, date: &str) -> AppResult<Vec<String>> {
    let view = build_day_view(conn, date, false)?;
    Ok(view.nodes.into_iter().map(|n| n.node.id).collect())
}

/// 供前端展示「为什么不可见」的中文说明。
pub fn describe_reason(reason: &crate::models::VisibilityReason) -> &'static str {
    use crate::models::VisibilityReason as R;
    match reason {
        R::SoftDeleted => "节点已删除",
        R::Cancelled => "节点已取消",
        R::OverlayHidden => "当日覆盖隐藏",
        R::OverlayForceVisible => "当日覆盖临时可见",
        R::CompletedAutoStop => "已完成，自动延续停止",
        R::ParentFollow => "跟随父节点",
        R::ParentFollowHidden => "父节点不可见",
        R::OccurrenceCover => "存在出现段",
        R::AutoContinuation => "自动延续中",
        R::DefaultHidden => "默认隐藏",
    }
}

/// 判断状态是否会因为「已完成」而中断延续（供前端提示）。
pub fn is_terminal(status: NodeStatus) -> bool {
    matches!(status, NodeStatus::Done | NodeStatus::Cancelled)
}
