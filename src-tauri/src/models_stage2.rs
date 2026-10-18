//! 阶段 2 新增数据结构：跟随覆盖、操作记录、每日快照。

use serde::{Deserialize, Serialize};

use crate::models::{DayEdge, DayOverlay, DayNodeLayout, FollowMode, Node, Occurrence};

// ============================================================================
// 子节点跟随覆盖（需求 6.11）
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FollowOverride {
    pub node_id: String,
    pub parent_id: String,
    pub mode: FollowMode,
    /// 生效区间（可空 = 不限）
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FollowOverrideInput {
    pub node_id: String,
    pub parent_id: String,
    #[serde(default)]
    pub mode: Option<FollowMode>,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub end_date: Option<String>,
}

// ============================================================================
// 操作记录（需求 6.5 / 4.7）
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationRecord {
    pub id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub action: String,
    pub before_json: Option<String>,
    pub after_json: Option<String>,
    pub diff_ref: Option<String>,
    pub batch_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationFilter {
    #[serde(default)]
    pub entity_type: Option<String>,
    #[serde(default)]
    pub entity_id: Option<String>,
    #[serde(default)]
    pub batch_id: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
}

// ============================================================================
// 每日快照（需求 6.6）
// ============================================================================

/// 快照内容：当天全部可见节点、出现段、当日覆盖、当天边、布局
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotPayload {
    pub date: String,
    pub created_at: String,
    pub nodes: Vec<Node>,
    pub occurrences: Vec<Occurrence>,
    pub overlays: Vec<DayOverlay>,
    pub edges: Vec<DayEdge>,
    pub layouts: Vec<DayNodeLayout>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotSummary {
    pub date: String,
    pub created_at: String,
    pub node_count: usize,
    pub occurrence_count: usize,
    pub overlay_count: usize,
    pub edge_count: usize,
    pub layout_count: usize,
    pub size_bytes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub date: String,
    pub snapshot_created_at: String,
    pub restored_edges: usize,
    pub restored_overlays: usize,
    pub restored_layouts: usize,
    /// 快照里包含但当前库中已不存在的节点数（这些节点不会被"复活"，只做提示）
    pub missing_nodes: usize,
}
