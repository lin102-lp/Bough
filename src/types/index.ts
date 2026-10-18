/**
 * 与 Rust 后端 `src-tauri/src/models.rs` 一一对应的类型定义。
 * serde 使用 camelCase，因此字段名与 Rust 结构体一致（仅大小写风格不同）。
 */

export type NodeStatus = "todo" | "doing" | "done" | "cancelled";
export type Continuation = "auto" | "manual" | "none" | "reappear";
export type OccurrenceSource = "auto" | "manual" | "reappear" | "follow";
export type EdgeType = "single" | "point";
export type FollowMode = "default" | "follow" | "never" | "delayed" | "independent";

/** 可见性判定命中的规则（优先级从高到低，见需求 4.2.6） */
export type VisibilityReason =
  | "soft_deleted" // 1 软删除
  | "cancelled" // 2 已取消
  | "overlay_hidden" // 3 当日覆盖 visible=false
  | "overlay_force_visible" // 3 当日覆盖「临时可见」（指向）
  | "completed_auto_stop" // 4 已完成 + 自动延续
  | "parent_follow" // 5 父节点跟随
  | "parent_follow_hidden" // 5 父节点不可见
  | "occurrence_cover" // 6 出现段覆盖
  | "auto_continuation" // 6 自动延续动态可见
  | "default_hidden"; // 7 默认隐藏

export interface Node {
  id: string;
  title: string;
  contentPath: string | null;
  starred: boolean;
  status: NodeStatus;
  completedAt: string | null;
  continuation: Continuation;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Occurrence {
  id: number;
  nodeId: string;
  startDate: string;
  /** 为空表示「持续」（开放段） */
  endDate: string | null;
  source: OccurrenceSource;
  isManualReappear: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DayOverlay {
  nodeId: string;
  date: string;
  title: string | null;
  content: string | null;
  visible: boolean | null;
  /** 临时可见：仅当天强制显示，不生成出现段（阶段 2） */
  forceVisible: boolean;
  sortOrder: number | null;
  styleJson: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DayEdge {
  id: string;
  date: string;
  fromNodeId: string;
  toNodeId: string;
  type: EdgeType;
  groupId: string | null;
  copiedFromDate: string | null;
  batchId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface DayNodeLayout {
  date: string;
  nodeId: string;
  x: number;
  y: number;
  collapsed: boolean;
  zIndex: number | null;
  anchor: string | null;
  level: number | null;
  updatedAt: string;
}

export interface VisibilityResult {
  visible: boolean;
  reason: VisibilityReason;
  /** 命中的优先级序号 1..=7 */
  rule: number;
  detail: string;
  sourceDate: string | null;
  occurrenceId: number | null;
  occurrenceSource: OccurrenceSource | null;
  parentId: string | null;
}

export interface VisibilityOptions {
  autoContinuation: boolean;
  parentFollow: boolean;
}

export interface DayNode {
  node: Node;
  displayTitle: string;
  overlay: DayOverlay | null;
  hasOverlayContent: boolean;
  overlayContentPreview: string | null;
  visibility: VisibilityResult;
  occurrence: Occurrence | null;
  continuedFrom: string | null;
  dayIndex: number | null;
}

export interface HiddenNode {
  node: Node;
  visibility: VisibilityResult;
}

export interface DayEdgeView {
  edge: DayEdge;
  fromVisible: boolean;
  toVisible: boolean;
  /** 同一天存在反向边 → UI 合并显示为双向箭头 */
  bidirectional: boolean;
}

export interface DayStats {
  candidateNodes: number;
  visible: number;
  hidden: number;
  edges: number;
  layouts: number;
}

export interface DayView {
  date: string;
  isToday: boolean;
  nodes: DayNode[];
  hidden: HiddenNode[];
  edges: DayEdgeView[];
  layouts: DayNodeLayout[];
  stats: DayStats;
  options: VisibilityOptions;
  generatedAt: string;
}

export interface NodeSummary {
  id: string;
  title: string;
  status: NodeStatus;
  starred: boolean;
  continuation: Continuation;
  createdAt: string;
  deletedAt: string | null;
}

export interface EdgeWithPeer {
  edge: DayEdge;
  peer: NodeSummary;
  outgoing: boolean;
}

export interface DayEdgeGroup {
  date: string;
  outgoing: EdgeWithPeer[];
  incoming: EdgeWithPeer[];
}

export interface OverlaySummary {
  date: string;
  hasTitle: boolean;
  hasContent: boolean;
  visible: boolean | null;
  updatedAt: string;
}

export interface TimeTreeStats {
  occurrenceCount: number;
  spanDays: number;
  firstDate: string | null;
  lastDate: string | null;
  childrenCount: number;
  edgeDays: number;
  pointedByCount: number;
}

export interface TimeTreeNode {
  node: NodeSummary;
  depth: number;
  children: TimeTreeNode[];
}

export interface NodeTimeTree {
  node: Node;
  parent: NodeSummary | null;
  occurrences: Occurrence[];
  children: NodeSummary[];
  childrenTree: TimeTreeNode[];
  dayEdges: DayEdgeGroup[];
  overlays: OverlaySummary[];
  stats: TimeTreeStats;
}

export interface NodeListItem {
  node: Node;
  occurrenceCount: number;
  firstDate: string | null;
  lastDate: string | null;
  hasOpenSpan: boolean;
  edgeCount: number;
}

export interface AppInfo {
  name: string;
  version: string;
  dataDir: string;
  dbPath: string;
  notesDir: string;
  overlaysDir: string;
  backupsDir: string;
  schemaVersion: number;
  today: string;
}

export interface BackupInfo {
  path: string;
  createdAt: string;
  sizeBytes: number;
}

export interface ContentRevision {
  id: number;
  nodeId: string;
  revision: number;
  content: string | null;
  isDiff: boolean;
  createdAt: string;
}

// ============================================================================
// 入参 DTO
// ============================================================================

/** 全量替换语义：未提供的字段使用默认值 / 清空 */
export interface NodeInput {
  id?: string | null;
  title: string;
  content?: string | null;
  starred?: boolean | null;
  status?: NodeStatus | null;
  continuation?: Continuation | null;
  parentId?: string | null;
  /** 操作发生的日期（创建时的出现段起点 / 完成时的截断日） */
  onDate?: string | null;
}

export interface OverlayInput {
  nodeId: string;
  date: string;
  title?: string | null;
  content?: string | null;
  visible?: boolean | null;
  forceVisible?: boolean | null;
  sortOrder?: number | null;
  styleJson?: string | null;
}

export interface OccurrenceInput {
  id?: number | null;
  nodeId: string;
  startDate: string;
  endDate?: string | null;
  source?: OccurrenceSource | null;
  isManualReappear?: boolean | null;
}

export interface EdgeInput {
  id?: string | null;
  date: string;
  fromNodeId: string;
  toNodeId: string;
  type?: EdgeType | null;
  groupId?: string | null;
  copiedFromDate?: string | null;
  batchId?: string | null;
}

export interface LayoutInput {
  nodeId: string;
  x: number;
  y: number;
  collapsed?: boolean | null;
  zIndex?: number | null;
  anchor?: string | null;
  level?: number | null;
}

export interface NodeListFilter {
  keyword?: string | null;
  statuses?: NodeStatus[] | null;
  starredOnly?: boolean | null;
  includeDeleted?: boolean | null;
  limit?: number | null;
}

export interface CopyEdgesRequest {
  fromDate: string;
  edgeIds?: string[] | null;
  /** 阶段 2：端点次日不可见时，自动补一天出现段再复制 */
  continueInvisible?: boolean | null;
}

export interface InvisibleEdgeInfo {
  edge: DayEdge;
  fromTitle: string;
  toTitle: string;
  fromVisible: boolean;
  toVisible: boolean;
  fromReason: VisibilityReason;
  toReason: VisibilityReason;
}

export interface CopyEdgesResult {
  fromDate: string;
  toDate: string;
  batchId: string | null;
  total: number;
  copied: DayEdge[];
  skippedInvisible: InvisibleEdgeInfo[];
  skippedDuplicate: number;
  /** 为了复制边而批量延续到次日的节点 */
  continuedNodes: NodeSummary[];
  /** 这些「仅次日」出现段的 id（撤销复制时一并删除） */
  continuedOccurrenceIds: number[];
}

export type SettingsMap = Record<string, string>;

// ============================================================================
// 前端内部类型
// ============================================================================

export type RightTab = "detail" | "timeline" | "history";
export type EditScope = "overlay" | "global";

export interface Toast {
  id: string;
  kind: "info" | "success" | "warning" | "error";
  message: string;
  detail?: string;
}

/** 会话内撤销栈的一条记录（补偿式撤销：apply 正向执行，revert 反向补偿） */
export interface HistoryEntry {
  id: string;
  label: string;
  apply: () => Promise<void>;
  revert: () => Promise<void>;
  /** 相同 key 的连续操作在 1.2 秒内会被合并为一步 */
  coalesceKey?: string;
  at: number;
}

// ============================================================================
// 阶段 2：跟随覆盖 / 操作记录 / 每日快照
// ============================================================================

export interface FollowOverride {
  nodeId: string;
  parentId: string;
  mode: FollowMode;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FollowOverrideInput {
  nodeId: string;
  parentId: string;
  mode?: FollowMode | null;
  startDate?: string | null;
  endDate?: string | null;
}

export interface OperationRecord {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  beforeJson: string | null;
  afterJson: string | null;
  diffRef: string | null;
  batchId: string | null;
  createdAt: string;
}

export interface OperationFilter {
  entityType?: string | null;
  entityId?: string | null;
  batchId?: string | null;
  limit?: number | null;
}

export interface SnapshotSummary {
  date: string;
  createdAt: string;
  nodeCount: number;
  occurrenceCount: number;
  overlayCount: number;
  edgeCount: number;
  layoutCount: number;
  sizeBytes: number;
}

export interface SnapshotPayload {
  date: string;
  createdAt: string;
  nodes: Node[];
  occurrences: Occurrence[];
  overlays: DayOverlay[];
  edges: DayEdge[];
  layouts: DayNodeLayout[];
}

export interface RestoreResult {
  date: string;
  snapshotCreatedAt: string;
  restoredEdges: number;
  restoredOverlays: number;
  restoredLayouts: number;
  missingNodes: number;
}
