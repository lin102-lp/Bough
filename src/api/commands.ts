/**
 * Tauri IPC 封装层：前端唯一与 Rust 通信的地方。
 *
 * 约定：
 * - 命令名与 Rust `#[tauri::command]` 函数名一致（snake_case）
 * - 参数名用 camelCase，Tauri 会自动映射到 Rust 的 snake_case 参数
 * - 错误统一转换成 Error，消息形如 `[conflict] ...`
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  AppInfo,
  BackupInfo,
  CopyEdgesRequest,
  CopyEdgesResult,
  DayEdge,
  DayNodeLayout,
  DayOverlay,
  DayView,
  FollowOverride,
  FollowOverrideInput,
  EdgeInput,
  LayoutInput,
  Node,
  NodeInput,
  NodeListItem,
  NodeListFilter,
  NodeStatus,
  NodeTimeTree,
  Occurrence,
  OperationFilter,
  OperationRecord,
  OccurrenceInput,
  OverlayInput,
  RestoreResult,
  SettingsMap,
  SnapshotSummary,
} from "@/types";

/** 是否运行在 Tauri 容器内（浏览器里打开时给出友好提示） */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new Error("当前不在 Tauri 容器中运行，请使用 `pnpm app:dev` 启动桌面应用。");
  }
  try {
    return await invoke<T>(cmd, args);
  } catch (raw) {
    const message =
      typeof raw === "string" ? raw : ((raw as { message?: string })?.message ?? String(raw));
    throw new Error(message);
  }
}

// ---------------------------------------------------------------------------
// 基础 / 设置
// ---------------------------------------------------------------------------

export const ping = () => call<string>("ping");
export const getAppInfo = () => call<AppInfo>("get_app_info");
export const getSettings = () => call<SettingsMap>("get_settings");
export const setSetting = (key: string, value: string) =>
  call<SettingsMap>("set_setting", { key, value });
export const createBackup = (label?: string) =>
  call<BackupInfo>("create_backup", { label: label ?? null });
export const listBackups = () => call<BackupInfo[]>("list_backups");
export const checkDataDir = () => call<boolean>("check_data_dir");

// ---------------------------------------------------------------------------
// 日期视图
// ---------------------------------------------------------------------------

export const getDayView = (date: string, includeHidden = true) =>
  call<DayView>("get_day_view", { date, includeHidden });

// ---------------------------------------------------------------------------
// 节点
// ---------------------------------------------------------------------------

export const listNodes = (filter?: NodeListFilter) =>
  call<NodeListItem[]>("list_nodes", { filter: filter ?? null });

export const searchNodes = (keyword: string, limit = 50) =>
  call<NodeListItem[]>("search_nodes", { keyword, limit });

export const getNode = (nodeId: string) => call<Node>("get_node", { nodeId });

export const saveNode = (input: NodeInput) => call<Node>("save_node", { input });

export const deleteNode = (nodeId: string) => call<void>("delete_node", { nodeId });

export const restoreNode = (nodeId: string) => call<void>("restore_node", { nodeId });

/** 物理删除：仅用于撤销「本次会话新建的节点」 */
export const purgeNode = (nodeId: string) => call<void>("purge_node", { nodeId });

export const setNodeStatus = (nodeId: string, status: NodeStatus, onDate?: string) =>
  call<Node>("set_node_status", { nodeId, status, onDate: onDate ?? null });

export const getNodeContent = (nodeId: string) => call<string>("get_node_content", { nodeId });

export const saveNodeContent = (nodeId: string, contentText: string) =>
  call<number>("save_node_content", { nodeId, contentText });

export const getNodePreviews = (nodeIds: string[], date?: string, maxChars = 140) =>
  call<Record<string, string>>("get_node_previews", {
    nodeIds,
    date: date ?? null,
    maxChars,
  });

// ---------------------------------------------------------------------------
// 出现段
// ---------------------------------------------------------------------------

export const listOccurrences = (nodeId: string) =>
  call<Occurrence[]>("list_occurrences", { nodeId });

export const addOccurrence = (input: OccurrenceInput) =>
  call<Occurrence>("add_occurrence", { input });

export const updateOccurrence = (input: OccurrenceInput) =>
  call<Occurrence>("update_occurrence", { input });

export const deleteOccurrence = (occurrenceId: number) =>
  call<void>("delete_occurrence", { occurrenceId });

export const continueNodeToNextDay = (nodeId: string, fromDate?: string, keepOpen = true) =>
  call<Occurrence>("continue_node_to_next_day", {
    nodeId,
    fromDate: fromDate ?? null,
    keepOpen,
  });

export const reappearNode = (nodeId: string, date: string, keepOpen = true) =>
  call<Occurrence>("reappear_node", { nodeId, date, keepOpen });

// ---------------------------------------------------------------------------
// 当日覆盖
// ---------------------------------------------------------------------------

export const getDayOverlay = (nodeId: string, date: string) =>
  call<DayOverlay | null>("get_day_overlay", { nodeId, date });

export const saveDayOverlay = (input: OverlayInput) =>
  call<DayOverlay | null>("save_day_overlay", { input });

export const clearDayOverlay = (nodeId: string, date: string) =>
  call<void>("clear_day_overlay", { nodeId, date });

/** 指向时给目标节点打「当天临时可见」标记（不生成出现段，可撤销） */
export const setDayForceVisible = (nodeId: string, date: string, force: boolean) =>
  call<DayOverlay | null>("set_day_force_visible", { nodeId, date, force });

// ---------------------------------------------------------------------------
// 当天边
// ---------------------------------------------------------------------------

export const listDayEdges = (date: string) => call<DayEdge[]>("list_day_edges", { date });

export const createEdge = (input: EdgeInput) => call<DayEdge>("create_edge", { input });

export const updateEdge = (input: EdgeInput) => call<DayEdge>("update_edge", { input });

export const deleteEdge = (edgeId: string) => call<void>("delete_edge", { edgeId });

export const deleteEdges = (edgeIds: string[]) => call<number>("delete_edges", { edgeIds });

export const deleteEdgeBatch = (batchId: string) =>
  call<number>("delete_edge_batch", { batchId });

/** 撤销「删除边」：恢复被软删除的单条边 */
export const restoreEdge = (edgeId: string) => call<void>("restore_edge", { edgeId });

/** 撤销「撤销复制」：恢复整批边 */
export const restoreEdgeBatch = (batchId: string) =>
  call<number>("restore_edge_batch", { batchId });

/** 物理删除边：仅用于撤销「本次会话新建的边」 */
export const purgeEdge = (edgeId: string) => call<void>("purge_edge", { edgeId });

export const copyEdgesToNextDay = (request: CopyEdgesRequest) =>
  call<CopyEdgesResult>("copy_edges_to_next_day", { request });

// ---------------------------------------------------------------------------
// 布局
// ---------------------------------------------------------------------------

export const getDayLayouts = (date: string) =>
  call<DayNodeLayout[]>("get_day_layouts", { date });

export const saveDayLayouts = (date: string, layouts: LayoutInput[]) =>
  call<number>("save_day_layouts", { date, layouts });

export const resetDayLayouts = (date: string) => call<number>("reset_day_layouts", { date });

// ---------------------------------------------------------------------------
// 时间树
// ---------------------------------------------------------------------------

export const getNodeTimeTree = (nodeId: string, maxDepth = 4, edgeLimit = 400) =>
  call<NodeTimeTree>("get_node_time_tree", { nodeId, maxDepth, edgeLimit });

// ---------------------------------------------------------------------------
// 阶段 2：子节点跟随覆盖
// ---------------------------------------------------------------------------

export const listFollowOverrides = (nodeId: string) =>
  call<FollowOverride[]>("list_follow_overrides", { nodeId });

export const setFollowOverride = (input: FollowOverrideInput) =>
  call<FollowOverride>("set_follow_override", { input });

export const deleteFollowOverride = (nodeId: string, parentId: string) =>
  call<number>("delete_follow_override", { nodeId, parentId });

// ---------------------------------------------------------------------------
// 阶段 2：操作记录 / 每日快照
// ---------------------------------------------------------------------------

export const listOperations = (filter?: OperationFilter) =>
  call<OperationRecord[]>("list_operations", { filter: filter ?? null });

export const listSnapshots = () => call<SnapshotSummary[]>("list_snapshots");

export const createSnapshot = (date: string) =>
  call<SnapshotSummary>("create_snapshot", { date });

export const ensureDailySnapshot = (date: string) =>
  call<SnapshotSummary | null>("ensure_daily_snapshot", { date });

export const deleteSnapshot = (date: string) => call<number>("delete_snapshot", { date });

export const restoreSnapshot = (date: string) => call<RestoreResult>("restore_snapshot", { date });
