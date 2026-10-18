//! 数据模型：与前端 `src/types/index.ts` 一一对应（serde 统一 camelCase）。
//!
//! 枚举内部一律英文，UI 层显示中文（中文映射见前端 `src/lib/labels.ts`）。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};

/// 生成「字符串枚举 + SQLite 编解码 + serde」的样板代码。
///
/// 支持在枚举与每个变体上写文档注释（会被原样保留）。
macro_rules! string_enum {
    (
        $(#[$meta:meta])*
        pub enum $name:ident {
            $( $(#[$variant_meta:meta])* $variant:ident => $text:literal ),+ $(,)?
        }
    ) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
        #[serde(rename_all = "lowercase")]
        pub enum $name {
            $( $(#[$variant_meta])* $variant ),+
        }

        impl $name {
            pub fn as_str(&self) -> &'static str {
                match self {
                    $( Self::$variant => $text ),+
                }
            }

            pub fn parse(s: &str) -> Option<Self> {
                match s {
                    $( $text => Some(Self::$variant), )+
                    _ => None,
                }
            }

            pub fn all() -> Vec<Self> {
                vec![ $( Self::$variant ),+ ]
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str(self.as_str())
            }
        }

        impl ToSql for $name {
            fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
                Ok(ToSqlOutput::from(self.as_str()))
            }
        }

        impl FromSql for $name {
            fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
                let raw = value.as_str()?;
                Self::parse(raw).ok_or_else(|| {
                    FromSqlError::Other(Box::new(EnumDecodeError {
                        enum_name: stringify!($name),
                        value: raw.to_string(),
                    }))
                })
            }
        }
    };
}

#[derive(Debug)]
struct EnumDecodeError {
    enum_name: &'static str,
    value: String,
}

impl std::fmt::Display for EnumDecodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "数据库中的 {} 取值非法：{}", self.enum_name, self.value)
    }
}

impl std::error::Error for EnumDecodeError {}

// ============================================================================
// 枚举
// ============================================================================

string_enum! {
    /// 节点状态（需求 4.1.2）
    pub enum NodeStatus {
        Todo => "todo",
        Doing => "doing",
        Done => "done",
        Cancelled => "cancelled",
    }
}

impl Default for NodeStatus {
    fn default() -> Self {
        NodeStatus::Todo
    }
}

impl NodeStatus {
    pub fn label_cn(&self) -> &'static str {
        match self {
            NodeStatus::Todo => "待办",
            NodeStatus::Doing => "进行中",
            NodeStatus::Done => "已完成",
            NodeStatus::Cancelled => "已取消",
        }
    }

    /// 是否为「活跃」状态（非完成、非取消）
    pub fn is_active(&self) -> bool {
        matches!(self, NodeStatus::Todo | NodeStatus::Doing)
    }
}

string_enum! {
    /// 延续策略（需求 4.1.6）
    pub enum Continuation {
        Auto => "auto",
        Manual => "manual",
        None => "none",
        Reappear => "reappear",
    }
}

impl Default for Continuation {
    fn default() -> Self {
        Continuation::Auto
    }
}

impl Continuation {
    pub fn label_cn(&self) -> &'static str {
        match self {
            Continuation::Auto => "自动延续",
            Continuation::Manual => "手动延续",
            Continuation::None => "不延续",
            Continuation::Reappear => "休眠后重现",
        }
    }
}

string_enum! {
    /// 出现段来源（需求 4.1.7）
    pub enum OccurrenceSource {
        Auto => "auto",
        Manual => "manual",
        Reappear => "reappear",
        Follow => "follow",
    }
}

impl Default for OccurrenceSource {
    fn default() -> Self {
        OccurrenceSource::Manual
    }
}

string_enum! {
    /// 当天边类型（需求 4.2.4：内部只保留两种）
    pub enum EdgeType {
        Single => "single",
        Point => "point",
    }
}

impl Default for EdgeType {
    fn default() -> Self {
        EdgeType::Single
    }
}

string_enum! {
    /// 子节点跟随模式（需求 6.11；阶段 2 使用）
    pub enum FollowMode {
        Default => "default",
        Follow => "follow",
        Never => "never",
        Delayed => "delayed",
        Independent => "independent",
    }
}

impl Default for FollowMode {
    fn default() -> Self {
        FollowMode::Default
    }
}

string_enum! {
    /// 可见性判定命中的规则（优先级从高到低，见需求 4.2.6）
    pub enum VisibilityReason {
        /// 1 软删除
        SoftDeleted => "soft_deleted",
        /// 2 已取消
        Cancelled => "cancelled",
        /// 3 当日覆盖 visible=false
        OverlayHidden => "overlay_hidden",
        /// 3 当日覆盖「临时可见」（指向时使用，需求 4.4.4）
        OverlayForceVisible => "overlay_force_visible",
        /// 4 已完成 + 自动延续，且日期晚于完成日
        CompletedAutoStop => "completed_auto_stop",
        /// 5 父节点跟随
        ParentFollow => "parent_follow",
        /// 5 父节点不可见导致子节点不可见
        ParentFollowHidden => "parent_follow_hidden",
        /// 6 出现段覆盖（手动出现段 / 重新出现）
        OccurrenceCover => "occurrence_cover",
        /// 6 自动延续动态可见（不物化出现段）
        AutoContinuation => "auto_continuation",
        /// 7 默认隐藏
        DefaultHidden => "default_hidden",
    }
}

// ============================================================================
// 实体
// ============================================================================

/// 节点（全局唯一）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub id: String,
    pub title: String,
    pub content_path: Option<String>,
    pub starred: bool,
    pub status: NodeStatus,
    pub completed_at: Option<String>,
    pub continuation: Continuation,
    pub parent_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

/// 出现段
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Occurrence {
    pub id: i64,
    pub node_id: String,
    pub start_date: String,
    /// 空表示「持续」（开放段）——自动延续节点的起始段就是开放段
    pub end_date: Option<String>,
    pub source: OccurrenceSource,
    pub is_manual_reappear: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// 当日覆盖（只对某一天生效的局部编辑）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayOverlay {
    pub node_id: String,
    pub date: String,
    pub title: Option<String>,
    pub content: Option<String>,
    /// 空值表示未覆盖，遵循全局可见性判定
    pub visible: Option<bool>,
    /// 临时可见：仅当天强制显示，不生成出现段（阶段 2，指向目标节点时使用）
    pub force_visible: bool,
    pub sort_order: Option<i64>,
    pub style_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// 当天边（只属于当天）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayEdge {
    pub id: String,
    pub date: String,
    pub from_node_id: String,
    pub to_node_id: String,
    #[serde(rename = "type")]
    pub kind: EdgeType,
    pub group_id: Option<String>,
    pub copied_from_date: Option<String>,
    pub batch_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

/// 日期图布局
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayNodeLayout {
    pub date: String,
    pub node_id: String,
    pub x: f64,
    pub y: f64,
    pub collapsed: bool,
    pub z_index: Option<i64>,
    pub anchor: Option<String>,
    pub level: Option<i64>,
    pub updated_at: String,
}

// ============================================================================
// 可见性
// ============================================================================

/// 可见性判定结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisibilityResult {
    pub visible: bool,
    pub reason: VisibilityReason,
    /// 命中的优先级序号 1..=7
    pub rule: u8,
    /// 人类可读说明（调试 / UI tooltip）
    pub detail: String,
    /// 延续来源：出现段起始日（用于「延续自 X」）
    pub source_date: Option<String>,
    pub occurrence_id: Option<i64>,
    pub occurrence_source: Option<OccurrenceSource>,
    pub parent_id: Option<String>,
}

impl VisibilityResult {
    pub fn hidden(reason: VisibilityReason, rule: u8, detail: impl Into<String>) -> Self {
        Self {
            visible: false,
            reason,
            rule,
            detail: detail.into(),
            source_date: None,
            occurrence_id: None,
            occurrence_source: None,
            parent_id: None,
        }
    }

    pub fn shown(reason: VisibilityReason, rule: u8, detail: impl Into<String>) -> Self {
        Self {
            visible: true,
            ..Self::hidden(reason, rule, detail)
        }
    }

    pub fn with_occurrence(mut self, occ: &Occurrence) -> Self {
        self.occurrence_id = Some(occ.id);
        self.occurrence_source = Some(occ.source);
        self.source_date = Some(occ.start_date.clone());
        self
    }

    pub fn with_parent(mut self, parent_id: Option<String>) -> Self {
        self.parent_id = parent_id;
        self
    }
}

/// 可见性引擎开关（阶段 1 默认只开自动延续，父节点跟随留到阶段 2）
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisibilityOptions {
    /// 自动延续动态可见（开放出现段 + 未完成）
    pub auto_continuation: bool,
    /// 子节点跟随（需求 4.1.8 / 4.2.6 规则 5）
    pub parent_follow: bool,
}

impl Default for VisibilityOptions {
    fn default() -> Self {
        Self {
            auto_continuation: true,
            parent_follow: false,
        }
    }
}

// ============================================================================
// 日期视图
// ============================================================================

/// 日期视图中的节点（全局本体 + 当天显示值 + 可见性）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayNode {
    pub node: Node,
    /// 合并当日覆盖后的显示标题
    pub display_title: String,
    pub overlay: Option<DayOverlay>,
    pub has_overlay_content: bool,
    pub overlay_content_preview: Option<String>,
    pub visibility: VisibilityResult,
    /// 命中的出现段
    pub occurrence: Option<Occurrence>,
    /// 延续起始日（= 出现段 start_date）
    pub continued_from: Option<String>,
    /// 该节点在这一段里是第几天出现（1 = 起始日）
    pub day_index: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HiddenNode {
    pub node: Node,
    pub visibility: VisibilityResult,
}

/// 边 + 两端可见性（前端据此决定是否渲染 / 提示）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayEdgeView {
    pub edge: DayEdge,
    pub from_visible: bool,
    pub to_visible: bool,
    /// 同一天存在反向边 → UI 合并显示为双向箭头
    pub bidirectional: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayStats {
    pub candidate_nodes: usize,
    pub visible: usize,
    pub hidden: usize,
    pub edges: usize,
    pub layouts: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayView {
    pub date: String,
    pub is_today: bool,
    pub nodes: Vec<DayNode>,
    pub hidden: Vec<HiddenNode>,
    pub edges: Vec<DayEdgeView>,
    pub layouts: Vec<DayNodeLayout>,
    pub stats: DayStats,
    pub options: VisibilityOptions,
    pub generated_at: String,
}

// ============================================================================
// 输入 / 输出 DTO
// ============================================================================

/// 保存节点入参（全量替换语义，未提供字段回落到默认值）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeInput {
    /// 为空则新建
    #[serde(default)]
    pub id: Option<String>,
    pub title: String,
    /// 仅在有值时写盘（避免每次保存都写 Markdown）
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub starred: Option<bool>,
    #[serde(default)]
    pub status: Option<NodeStatus>,
    #[serde(default)]
    pub continuation: Option<Continuation>,
    #[serde(default)]
    pub parent_id: Option<String>,
    /// 操作发生的日期（创建节点时的出现段起点、完成时的截断日），默认今天
    #[serde(default)]
    pub on_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayInput {
    pub node_id: String,
    pub date: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub visible: Option<bool>,
    #[serde(default)]
    pub force_visible: Option<bool>,
    #[serde(default)]
    pub sort_order: Option<i64>,
    #[serde(default)]
    pub style_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OccurrenceInput {
    #[serde(default)]
    pub id: Option<i64>,
    pub node_id: String,
    pub start_date: String,
    #[serde(default)]
    pub end_date: Option<String>,
    #[serde(default)]
    pub source: Option<OccurrenceSource>,
    #[serde(default)]
    pub is_manual_reappear: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EdgeInput {
    #[serde(default)]
    pub id: Option<String>,
    pub date: String,
    pub from_node_id: String,
    pub to_node_id: String,
    #[serde(default, rename = "type")]
    pub kind: Option<EdgeType>,
    #[serde(default)]
    pub group_id: Option<String>,
    #[serde(default)]
    pub copied_from_date: Option<String>,
    #[serde(default)]
    pub batch_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutInput {
    pub node_id: String,
    pub x: f64,
    pub y: f64,
    #[serde(default)]
    pub collapsed: Option<bool>,
    #[serde(default)]
    pub z_index: Option<i64>,
    #[serde(default)]
    pub anchor: Option<String>,
    #[serde(default)]
    pub level: Option<i64>,
}

/// 节点列表项（左侧面板 / 搜索结果）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeListItem {
    pub node: Node,
    pub occurrence_count: i64,
    pub first_date: Option<String>,
    pub last_date: Option<String>,
    /// 是否存在开放出现段
    pub has_open_span: bool,
    pub edge_count: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeListFilter {
    #[serde(default)]
    pub keyword: Option<String>,
    #[serde(default)]
    pub statuses: Option<Vec<NodeStatus>>,
    #[serde(default)]
    pub starred_only: Option<bool>,
    #[serde(default)]
    pub include_deleted: Option<bool>,
    #[serde(default)]
    pub limit: Option<i64>,
}

// ============================================================================
// 复制边
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyEdgesRequest {
    pub from_date: String,
    /// 为空表示复制当天所有边
    #[serde(default)]
    pub edge_ids: Option<Vec<String>>,
    /// 阶段 2 完整版：端点次日不可见时，自动为它补一个「仅次日」的出现段再复制
    #[serde(default)]
    pub continue_invisible: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvisibleEdgeInfo {
    pub edge: DayEdge,
    pub from_title: String,
    pub to_title: String,
    pub from_visible: bool,
    pub to_visible: bool,
    pub from_reason: VisibilityReason,
    pub to_reason: VisibilityReason,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyEdgesResult {
    pub from_date: String,
    pub to_date: String,
    /// 为空表示什么都没复制（无需撤销）
    pub batch_id: Option<String>,
    pub total: usize,
    pub copied: Vec<DayEdge>,
    /// 端点次日不可见 → 跳过（阶段 1 不自动延续节点）
    pub skipped_invisible: Vec<InvisibleEdgeInfo>,
    /// 目标日已存在同样的边（唯一约束）
    pub skipped_duplicate: usize,
    /// 阶段 2：本次为了复制边而"批量延续"到次日的节点
    pub continued_nodes: Vec<NodeSummary>,
    /// 这些「仅次日」出现段的 id，撤销复制时一并删除
    pub continued_occurrence_ids: Vec<i64>,
}

// ============================================================================
// 节点时间树
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeSummary {
    pub id: String,
    pub title: String,
    pub status: NodeStatus,
    pub starred: bool,
    pub continuation: Continuation,
    pub created_at: String,
    pub deleted_at: Option<String>,
}

impl From<&Node> for NodeSummary {
    fn from(n: &Node) -> Self {
        Self {
            id: n.id.clone(),
            title: n.title.clone(),
            status: n.status,
            starred: n.starred,
            continuation: n.continuation,
            created_at: n.created_at.clone(),
            deleted_at: n.deleted_at.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeTreeNode {
    pub node: NodeSummary,
    pub depth: i64,
    pub children: Vec<TimeTreeNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EdgeWithPeer {
    pub edge: DayEdge,
    pub peer: NodeSummary,
    /// true = 该节点是起点（本节点 → peer）
    pub outgoing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayEdgeGroup {
    pub date: String,
    pub outgoing: Vec<EdgeWithPeer>,
    pub incoming: Vec<EdgeWithPeer>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlaySummary {
    pub date: String,
    pub has_title: bool,
    pub has_content: bool,
    pub visible: Option<bool>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeTreeStats {
    pub occurrence_count: i64,
    pub span_days: i64,
    pub first_date: Option<String>,
    pub last_date: Option<String>,
    pub children_count: i64,
    pub edge_days: i64,
    pub pointed_by_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeTimeTree {
    pub node: Node,
    pub parent: Option<NodeSummary>,
    pub occurrences: Vec<Occurrence>,
    pub children: Vec<NodeSummary>,
    pub children_tree: Vec<TimeTreeNode>,
    pub day_edges: Vec<DayEdgeGroup>,
    pub overlays: Vec<OverlaySummary>,
    pub stats: TimeTreeStats,
}

// ============================================================================
// 应用信息 / 备份
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub data_dir: String,
    pub db_path: String,
    pub notes_dir: String,
    pub overlays_dir: String,
    pub backups_dir: String,
    pub schema_version: i64,
    pub today: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub path: String,
    pub created_at: String,
    pub size_bytes: u64,
}

/// 设置表：key → value（全部为字符串，布尔用 "0"/"1"）
pub type SettingsMap = HashMap<String, String>;
