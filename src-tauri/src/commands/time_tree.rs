//! 节点时间树（需求 4.3）：出现段 + 子节点树 + 每日边分组 + 覆盖摘要。

use crate::error::AppResult;
use crate::models::{
    DayEdgeGroup, EdgeWithPeer, NodeSummary, NodeTimeTree, OverlaySummary, TimeTreeNode,
    TimeTreeStats,
};
use crate::repo;
use crate::state::AppState;
use crate::util;
use rusqlite::Connection;
use std::collections::{HashMap, HashSet};
use tauri::State;

const DEFAULT_MAX_DEPTH: i64 = 4;
const DEFAULT_EDGE_LIMIT: i64 = 400;

/// 递归构建子节点树（带访问集合，防止数据异常导致的环）。
fn build_children_tree(
    conn: &Connection,
    parent_id: &str,
    depth: i64,
    max_depth: i64,
    visited: &mut HashSet<String>,
) -> AppResult<Vec<TimeTreeNode>> {
    if depth >= max_depth {
        return Ok(Vec::new());
    }
    let kids = repo::nodes::children(conn, parent_id)?;
    let mut out = Vec::new();
    for kid in kids {
        if !visited.insert(kid.id.clone()) {
            continue;
        }
        let children = build_children_tree(conn, &kid.id, depth + 1, max_depth, visited)?;
        out.push(TimeTreeNode {
            node: NodeSummary::from(&kid),
            depth: depth + 1,
            children,
        });
    }
    Ok(out)
}

#[tauri::command(async)]
pub fn get_node_time_tree(
    state: State<'_, AppState>,
    node_id: String,
    max_depth: Option<i64>,
    edge_limit: Option<i64>,
) -> AppResult<NodeTimeTree> {
    let depth = max_depth.unwrap_or(DEFAULT_MAX_DEPTH).clamp(1, 12);
    let edge_limit = edge_limit.unwrap_or(DEFAULT_EDGE_LIMIT).clamp(1, 5000);
    let conn = state.lock();
    let today = util::today_str();

    let node = repo::nodes::get_or_err(&conn, &node_id)?;
    let parent = match node.parent_id.as_deref() {
        Some(pid) => repo::nodes::get(&conn, pid)?.map(|p| NodeSummary::from(&p)),
        None => None,
    };

    let occurrences = repo::occurrences::list_by_node(&conn, &node_id)?;

    let children = repo::nodes::children(&conn, &node_id)?
        .iter()
        .map(NodeSummary::from)
        .collect::<Vec<_>>();

    let mut visited: HashSet<String> = HashSet::new();
    visited.insert(node_id.clone());
    let children_tree = build_children_tree(&conn, &node_id, 0, depth, &mut visited)?;

    // ---------- 每日边：按日期分组，标注对端 ----------
    let edges = repo::edges::list_by_node(&conn, &node_id, edge_limit)?;
    let peer_ids: Vec<String> = {
        let mut ids = Vec::new();
        for e in &edges {
            let peer = if e.from_node_id == node_id {
                &e.to_node_id
            } else {
                &e.from_node_id
            };
            if !ids.contains(peer) {
                ids.push(peer.clone());
            }
        }
        ids
    };
    let mut peers: HashMap<String, NodeSummary> = HashMap::new();
    for pid in peer_ids {
        if let Some(p) = repo::nodes::get(&conn, &pid)? {
            peers.insert(pid, NodeSummary::from(&p));
        }
    }

    let mut grouped: HashMap<String, DayEdgeGroup> = HashMap::new();
    for edge in edges {
        let outgoing = edge.from_node_id == node_id;
        let peer_id = if outgoing {
            edge.to_node_id.clone()
        } else {
            edge.from_node_id.clone()
        };
        let peer = peers
            .get(&peer_id)
            .cloned()
            .unwrap_or_else(|| NodeSummary {
                id: peer_id.clone(),
                title: format!("（已删除 {peer_id}）"),
                status: crate::models::NodeStatus::Todo,
                starred: false,
                continuation: crate::models::Continuation::None,
                created_at: String::new(),
                deleted_at: None,
            });
        let entry = grouped
            .entry(edge.date.clone())
            .or_insert_with(|| DayEdgeGroup {
                date: edge.date.clone(),
                outgoing: Vec::new(),
                incoming: Vec::new(),
            });
        let item = EdgeWithPeer {
            edge,
            peer,
            outgoing,
        };
        if outgoing {
            entry.outgoing.push(item);
        } else {
            entry.incoming.push(item);
        }
    }
    let mut day_edges: Vec<DayEdgeGroup> = grouped.into_values().collect();
    day_edges.sort_by(|a, b| b.date.cmp(&a.date));

    // ---------- 当日覆盖摘要 ----------
    let overlays: Vec<OverlaySummary> = repo::overlays::list_by_node(&conn, &node_id, 200)?
        .into_iter()
        .map(|o| OverlaySummary {
            date: o.date,
            has_title: o.title.as_ref().is_some_and(|t| !t.is_empty()),
            has_content: o.content.as_ref().is_some_and(|c| !c.is_empty()),
            visible: o.visible,
            updated_at: o.updated_at,
        })
        .collect();

    // ---------- 统计 ----------
    let mut span_days = 0i64;
    let mut first_date: Option<String> = None;
    let mut last_date: Option<String> = None;
    for occ in &occurrences {
        let end = occ.end_date.clone().unwrap_or_else(|| today.clone());
        if let Ok(len) = util::diff_days(&occ.start_date, &end) {
            span_days += len.max(0) + 1;
        }
        first_date = Some(match &first_date {
            Some(cur) if cur < &occ.start_date => cur.clone(),
            _ => occ.start_date.clone(),
        });
        last_date = Some(match &last_date {
            Some(cur) if cur > &end => cur.clone(),
            _ => end,
        });
    }

    let stats = TimeTreeStats {
        occurrence_count: occurrences.len() as i64,
        span_days,
        first_date,
        last_date,
        children_count: children.len() as i64,
        edge_days: day_edges.len() as i64,
        pointed_by_count: repo::edges::count_pointed_by(&conn, &node_id)?,
    };

    Ok(NodeTimeTree {
        node,
        parent,
        occurrences,
        children,
        children_tree,
        day_edges,
        overlays,
        stats,
    })
}
