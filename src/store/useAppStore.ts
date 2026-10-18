/**
 * 全局状态（Zustand + Immer）与会话内撤销/重做。
 *
 * 撤销模型：**补偿式撤销**
 * 每条可撤销操作同时提供 `apply`（正向）与 `revert`（反向补偿命令），
 * 两者都调用后端命令，因此撤销后数据库与 UI 始终一致（后端是唯一真相源）。
 *
 * 撤销栈只存在内存里（会话内撤销 = 阶段 1 目标；阶段 2 会改用 operations 表持久化）。
 */

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

import * as api from "@/api/commands";
import { computeAutoLayout } from "@/lib/autolayout";
import { nextDate, prevDate, today as todayStr } from "@/lib/date";
import { statusLabel } from "@/lib/labels";
import { errorMessage, newId, stripErrorCode } from "@/lib/util";
import type {
  AppInfo,
  Continuation,
  CopyEdgesResult,
  DayView,
  FollowOverride,
  FollowOverrideInput,
  LayoutInput,
  Node,
  NodeInput,
  NodeListItem,
  NodeListFilter,
  NodeStatus,
  NodeTimeTree,
  Occurrence,
  OperationRecord,
  RightTab,
  SettingsMap,
  SnapshotSummary,
  Toast,
} from "@/types";
import type { HistoryEntry } from "@/types";

const MAX_HISTORY = 120;
const COALESCE_MS = 1200;

interface LayoutSnapshot {
  nodeIds: string[];
  before: Array<{ nodeId: string; x: number; y: number }>;
}

/** 用小对象持有闭包内赋值的结果，避免 TS 控制流分析把变量窄化成 never */
interface Holder<T> {
  value: T | null;
}

export interface AppStore {
  // ---------------- 数据 ----------------
  currentDate: string;
  dayView: DayView | null;
  loading: boolean;
  error: string | null;
  appInfo: AppInfo | null;
  settings: SettingsMap;
  nodeList: NodeListItem[];
  previews: Record<string, string>;
  timeline: NodeTimeTree | null;
  timelineLoading: boolean;

  // ---------------- UI ----------------
  selectedNodeIds: string[];
  selectedEdgeIds: string[];
  connectMode: boolean;
  connectSourceId: string | null;
  detailNodeId: string | null;
  rightTab: RightTab;
  showHidden: boolean;
  searchKeyword: string;
  starredOnly: boolean;
  statusFilter: NodeStatus[];
  listScope: "day" | "all" | "hidden";
  toasts: Toast[];
  copyResult: CopyEdgesResult | null;
  settingsOpen: boolean;
  /** 阶段 2 */
  followOverrides: FollowOverride[];
  operations: OperationRecord[];
  snapshots: SnapshotSummary[];
  pointDialogOpen: boolean;

  // ---------------- 撤销 ----------------
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  historyBusy: boolean;
  pendingLayout: LayoutSnapshot | null;

  // ---------------- 派生 ----------------
  renderableNodeIds: () => string[];

  // ---------------- 初始化 ----------------
  bootstrap: () => Promise<void>;
  loadDay: (date?: string) => Promise<void>;
  setDate: (date: string) => Promise<void>;
  shiftDay: (delta: number) => Promise<void>;
  goToday: () => Promise<void>;
  refreshNodeList: (filter?: NodeListFilter) => Promise<void>;
  loadPreviews: () => Promise<void>;

  // ---------------- 节点 ----------------
  createNode: (partial?: Partial<NodeInput> & { select?: boolean }) => Promise<string | null>;
  updateNodeMeta: (
    id: string,
    patch: {
      title?: string;
      starred?: boolean;
      status?: NodeStatus;
      continuation?: Continuation;
      parentId?: string | null;
    },
  ) => Promise<void>;
  setNodeStatus: (id: string, status: NodeStatus) => Promise<void>;
  toggleStar: (id: string) => Promise<void>;
  renameNode: (id: string, title: string) => Promise<void>;
  saveNodeContent: (id: string, text: string) => Promise<void>;
  deleteNode: (id: string) => Promise<void>;

  // ---------------- 当日覆盖 ----------------
  saveOverlay: (input: {
    nodeId: string;
    title?: string | null;
    content?: string | null;
    visible?: boolean | null;
    sortOrder?: number | null;
  }) => Promise<void>;
  clearOverlay: (nodeId: string) => Promise<void>;
  setDayVisible: (nodeId: string, visible: boolean) => Promise<void>;

  // ---------------- 当天边 ----------------
  createEdgeBetween: (from: string, to: string, type?: "single" | "point") => Promise<void>;
  createEdgesFromSelection: (type?: "single" | "point") => Promise<void>;
  deleteEdge: (edgeId: string) => Promise<void>;
  deleteSelectedEdges: () => Promise<void>;
  copyEdgesToNextDay: (edgeIds?: string[], continueInvisible?: boolean) => Promise<void>;
  undoCopyBatch: (batchId: string) => Promise<void>;
  dismissCopyResult: () => void;
  /** 阶段 2：重新复制时顺便延续端点不可见的节点 */
  copyWithContinuation: (edgeIds?: string[]) => Promise<void>;

  // ---------------- 阶段 2：跟随覆盖 ----------------
  loadFollowOverrides: (nodeId: string) => Promise<void>;
  saveFollowOverride: (input: FollowOverrideInput) => Promise<void>;
  deleteFollowOverride: (nodeId: string, parentId: string) => Promise<void>;
  setDayForceVisible: (nodeId: string, force: boolean) => Promise<void>;

  // ---------------- 阶段 2：历史与快照 ----------------
  loadHistory: () => Promise<void>;
  createSnapshot: () => Promise<void>;
  restoreSnapshot: (date: string) => Promise<void>;
  deleteSnapshot: (date: string) => Promise<void>;

  // ---------------- 阶段 2：指向 ----------------
  openPointDialog: () => void;
  closePointDialog: () => void;
  confirmPoint: (
    targetId: string | null,
    newTitle: string | null,
    forceVisible: boolean,
  ) => Promise<void>;

  // ---------------- 出现段 ----------------
  addOccurrence: (
    nodeId: string,
    startDate: string,
    endDate?: string | null,
    source?: Occurrence["source"],
  ) => Promise<void>;
  deleteOccurrence: (occurrenceId: number, nodeId?: string) => Promise<void>;
  continueToNextDay: (nodeId: string) => Promise<void>;
  reappearToday: (nodeId: string) => Promise<void>;

  // ---------------- 布局 ----------------
  ensureLayouts: () => Promise<void>;
  setNodePosition: (nodeId: string, x: number, y: number) => void;
  beginLayoutDrag: (nodeIds: string[]) => void;
  commitLayoutDrag: () => Promise<void>;
  resetLayout: () => Promise<void>;
  autoArrange: () => Promise<void>;

  // ---------------- 时间树 ----------------
  openDetail: (nodeId: string, tab?: RightTab) => Promise<void>;
  setRightTab: (tab: RightTab) => void;
  closeDetail: () => void;
  loadTimeline: (nodeId: string) => Promise<void>;

  // ---------------- 撤销 / 重做 ----------------
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  runWithHistory: (entry: Omit<HistoryEntry, "id" | "at">) => Promise<void>;

  // ---------------- 杂项 ----------------
  pushToast: (toast: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;
  setError: (message: string | null) => void;
  setSettingValue: (key: string, value: string) => Promise<void>;
  updateAppInfo: (info: AppInfo) => void;
  setShowHidden: (value: boolean) => void;
  setSearchKeyword: (value: string) => void;
  setStarredOnly: (value: boolean) => void;
  toggleStatusFilter: (status: NodeStatus) => void;
  setListScope: (scope: "day" | "all" | "hidden") => void;
  setSettingsOpen: (open: boolean) => void;
  toggleConnectMode: () => void;
  setConnectSource: (nodeId: string | null) => void;
  setSelectedNodes: (ids: string[]) => void;
  setSelectedEdges: (ids: string[]) => void;
  selectAllVisible: () => void;
  clearSelection: () => void;
}

/** 防止 ensureLayouts 与 loadDay 相互递归 */
let layoutSyncing = false;

export const useAppStore = create<AppStore>()(
  immer((set, get) => {
    /** 统一的「执行 + 记录历史」入口 */
    const runWithHistory = async (entry: Omit<HistoryEntry, "id" | "at">) => {
      await entry.apply();
      const at = Date.now();
      set((s) => {
        const last = s.undoStack[s.undoStack.length - 1];
        if (
          entry.coalesceKey &&
          last &&
          last.coalesceKey === entry.coalesceKey &&
          at - last.at < COALESCE_MS
        ) {
          // 合并：保留最早的 revert（回到最初状态），使用最新的 apply
          last.at = at;
          last.apply = entry.apply;
          last.label = entry.label;
        } else {
          s.undoStack.push({ ...entry, id: newId("h"), at });
          if (s.undoStack.length > MAX_HISTORY) s.undoStack.shift();
        }
        s.redoStack = [];
      });
    };

    const notifyError = (error: unknown, fallback: string) => {
      const message = stripErrorCode(errorMessage(error));
      set((s) => {
        s.error = message;
        s.toasts.push({
          id: newId("toast"),
          kind: "error",
          message: fallback,
          detail: message,
        });
      });
    };

    return {
      // ---------------- 初始值 ----------------
      currentDate: todayStr(),
      dayView: null,
      loading: false,
      error: null,
      appInfo: null,
      settings: {},
      nodeList: [],
      previews: {},
      timeline: null,
      timelineLoading: false,

      selectedNodeIds: [],
      selectedEdgeIds: [],
      connectMode: false,
      connectSourceId: null,
      detailNodeId: null,
      rightTab: "detail",
      showHidden: false,
      searchKeyword: "",
      starredOnly: false,
      statusFilter: [],
      listScope: "day",
      toasts: [],
      copyResult: null,
      settingsOpen: false,
      followOverrides: [],
      operations: [],
      snapshots: [],
      pointDialogOpen: false,

      undoStack: [],
      redoStack: [],
      historyBusy: false,
      pendingLayout: null,

      renderableNodeIds: () => {
        const view = get().dayView;
        if (!view) return [];
        const visible = view.nodes.map((n) => n.node.id);
        if (!get().showHidden) return visible;
        return [...visible, ...view.hidden.map((h) => h.node.id)];
      },

      // ---------------- 初始化 ----------------
      bootstrap: async () => {
        try {
          const info = await api.getAppInfo();
          const settings = await api.getSettings();
          set((s) => {
            s.appInfo = info;
            s.settings = settings;
            s.currentDate = info.today || todayStr();
            s.showHidden = settings["ui.show_hidden"] === "1";
          });
          await get().loadDay();
          await get().refreshNodeList();
        } catch (error) {
          notifyError(error, "初始化失败");
        }
      },

      loadDay: async (date) => {
        const target = date ?? get().currentDate;
        set((s) => {
          s.loading = true;
          s.error = null;
          s.currentDate = target;
        });
        try {
          const view = await api.getDayView(target, true);
          set((s) => {
            s.dayView = view;
            const alive = new Set(view.nodes.map((n) => n.node.id));
            s.selectedNodeIds = s.selectedNodeIds.filter((id) => alive.has(id));
            const edgeIds = new Set(view.edges.map((e) => e.edge.id));
            s.selectedEdgeIds = s.selectedEdgeIds.filter((id) => edgeIds.has(id));
          });
          await get().ensureLayouts();
          await get().loadPreviews();
          const detailId = get().detailNodeId;
          if (detailId) {
            await get().loadTimeline(detailId);
            await get().loadFollowOverrides(detailId);
          }
          // 每天首次进入自动生成一份快照（需求 6.6）
          void api.ensureDailySnapshot(target).catch(() => undefined);
        } catch (error) {
          notifyError(error, "加载日期视图失败");
        } finally {
          set((s) => {
            s.loading = false;
          });
        }
      },

      setDate: async (date) => {
        if (date === get().currentDate) return;
        await get().loadDay(date);
      },

      shiftDay: async (delta) => {
        const current = get().currentDate;
        await get().loadDay(delta >= 0 ? nextDate(current) : prevDate(current));
      },

      goToday: async () => {
        await get().loadDay(todayStr());
      },

      refreshNodeList: async (filter) => {
        try {
          const scope = get().listScope;
          const effective: NodeListFilter = {
            keyword: filter?.keyword ?? (get().searchKeyword || null),
            starredOnly: filter?.starredOnly ?? (get().starredOnly || null),
            statuses: filter?.statuses ?? (get().statusFilter.length ? get().statusFilter : null),
            includeDeleted: false,
            limit: scope === "all" ? 800 : 400,
          };
          const list = await api.listNodes(effective);
          set((s) => {
            s.nodeList = list;
          });
        } catch (error) {
          notifyError(error, "加载节点列表失败");
        }
      },

      loadPreviews: async () => {
        const view = get().dayView;
        if (!view) return;
        const ids = view.nodes.map((n) => n.node.id);
        if (ids.length === 0) return;
        try {
          const previews = await api.getNodePreviews(ids.slice(0, 300), view.date, 140);
          set((s) => {
            s.previews = { ...s.previews, ...previews };
          });
        } catch {
          // 预览失败不影响主流程
        }
      },

      // ---------------- 节点 ----------------
      createNode: async (partial) => {
        const date = get().currentDate;
        const id = partial?.id ?? newId("node");
        const input: NodeInput = {
          id,
          title: partial?.title?.trim() || "新节点",
          status: partial?.status ?? "todo",
          starred: partial?.starred ?? false,
          continuation: partial?.continuation ?? null,
          parentId: partial?.parentId ?? null,
          onDate: date,
        };
        try {
          await get().runWithHistory({
            label: `新建节点「${input.title}」`,
            apply: async () => {
              await api.saveNode(input);
            },
            revert: async () => {
              await api.purgeNode(id);
            },
          });
          set((s) => {
            s.selectedNodeIds = [id];
            s.detailNodeId = id;
            s.rightTab = "detail";
          });
          await get().loadDay();
          await get().refreshNodeList();
          return id;
        } catch (error) {
          notifyError(error, "新建节点失败");
          return null;
        }
      },

      updateNodeMeta: async (id, patch) => {
        try {
          const before = await api.getNode(id);
          const makeInput = (source: Node): NodeInput => ({
            id,
            title: patch.title ?? source.title,
            starred: patch.starred ?? source.starred,
            status: patch.status ?? source.status,
            continuation: patch.continuation ?? source.continuation,
            parentId: patch.parentId !== undefined ? patch.parentId : source.parentId,
            onDate: get().currentDate,
          });
          const after = makeInput(before);
          const back: NodeInput = {
            id,
            title: before.title,
            starred: before.starred,
            status: before.status,
            continuation: before.continuation,
            parentId: before.parentId,
            onDate: get().currentDate,
          };
          await get().runWithHistory({
            label: `编辑「${before.title}」`,
            apply: async () => {
              await api.saveNode(after);
            },
            revert: async () => {
              await api.saveNode(back);
            },
            coalesceKey: `node:${id}`,
          });
          await get().loadDay();
          await get().refreshNodeList();
        } catch (error) {
          notifyError(error, "保存节点失败");
        }
      },

      setNodeStatus: async (id, status) => {
        try {
          const before = await api.getNode(id);
          const back: NodeInput = {
            id,
            title: before.title,
            starred: before.starred,
            status: before.status,
            continuation: before.continuation,
            parentId: before.parentId,
            onDate: get().currentDate,
          };
          await get().runWithHistory({
            label: `状态改为「${statusLabel(status)}」`,
            apply: async () => {
              await api.setNodeStatus(id, status, get().currentDate);
            },
            revert: async () => {
              await api.saveNode(back);
            },
          });
          await get().loadDay();
        } catch (error) {
          notifyError(error, "修改状态失败");
        }
      },

      toggleStar: async (id) => {
        try {
          const node = await api.getNode(id);
          const base: NodeInput = {
            id,
            title: node.title,
            starred: node.starred,
            status: node.status,
            continuation: node.continuation,
            parentId: node.parentId,
            onDate: get().currentDate,
          };
          await get().runWithHistory({
            label: node.starred ? "取消星标" : "标记为重要",
            apply: async () => {
              await api.saveNode({ ...base, starred: !node.starred });
            },
            revert: async () => {
              await api.saveNode(base);
            },
          });
          await get().loadDay();
        } catch (error) {
          notifyError(error, "切换星标失败");
        }
      },

      renameNode: async (id, title) => {
        await get().updateNodeMeta(id, { title });
      },

      saveNodeContent: async (id, text) => {
        try {
          const old = await api.getNodeContent(id);
          if (old === text) return;
          await get().runWithHistory({
            label: "编辑正文",
            apply: async () => {
              await api.saveNodeContent(id, text);
            },
            revert: async () => {
              await api.saveNodeContent(id, old);
            },
            coalesceKey: `content:${id}`,
          });
          set((s) => {
            s.previews[id] = text.slice(0, 140);
          });
          await get().loadDay();
        } catch (error) {
          notifyError(error, "保存正文失败");
        }
      },

      deleteNode: async (id) => {
        try {
          const node = await api.getNode(id);
          await get().runWithHistory({
            label: `删除「${node.title}」`,
            apply: async () => {
              await api.deleteNode(id);
            },
            revert: async () => {
              await api.restoreNode(id);
            },
          });
          set((s) => {
            if (s.detailNodeId === id) {
              s.detailNodeId = null;
              s.timeline = null;
            }
            s.selectedNodeIds = s.selectedNodeIds.filter((n) => n !== id);
          });
          await get().loadDay();
          await get().refreshNodeList();
        } catch (error) {
          notifyError(error, "删除节点失败");
        }
      },

      // ---------------- 当日覆盖 ----------------
      saveOverlay: async (input) => {
        const date = get().currentDate;
        const before = await api.getDayOverlay(input.nodeId, date);
        const after = {
          nodeId: input.nodeId,
          date,
          title: input.title ?? null,
          content: input.content ?? null,
          visible: input.visible ?? null,
          sortOrder: input.sortOrder ?? null,
        };
        try {
          await get().runWithHistory({
            label: before ? "修改当日覆盖" : "新建当日覆盖",
            apply: async () => {
              await api.saveDayOverlay(after);
            },
            revert: async () => {
              if (before) {
                await api.saveDayOverlay({
                  nodeId: before.nodeId,
                  date: before.date,
                  title: before.title,
                  content: before.content,
                  visible: before.visible,
                  sortOrder: before.sortOrder,
                  styleJson: before.styleJson,
                });
              } else {
                await api.clearDayOverlay(input.nodeId, date);
              }
            },
            coalesceKey: `overlay:${input.nodeId}:${date}`,
          });
          await get().loadDay();
        } catch (error) {
          notifyError(error, "保存当日覆盖失败");
        }
      },

      clearOverlay: async (nodeId) => {
        const date = get().currentDate;
        const before = await api.getDayOverlay(nodeId, date);
        if (!before) return;
        try {
          await get().runWithHistory({
            label: "清除当日覆盖",
            apply: async () => {
              await api.clearDayOverlay(nodeId, date);
            },
            revert: async () => {
              await api.saveDayOverlay({
                nodeId: before.nodeId,
                date: before.date,
                title: before.title,
                content: before.content,
                visible: before.visible,
                sortOrder: before.sortOrder,
                styleJson: before.styleJson,
              });
            },
          });
          await get().loadDay();
        } catch (error) {
          notifyError(error, "清除当日覆盖失败");
        }
      },

      setDayVisible: async (nodeId, visible) => {
        await get().saveOverlay({ nodeId, visible });
      },

      // ---------------- 当天边 ----------------
      createEdgeBetween: async (from, to, type = "single") => {
        if (from === to) {
          get().pushToast({ kind: "warning", message: "不能连接到自身" });
          return;
        }
        const date = get().currentDate;
        const exists = get().dayView?.edges.some(
          (e) => e.edge.fromNodeId === from && e.edge.toNodeId === to && e.edge.type === type,
        );
        if (exists) {
          get().pushToast({ kind: "warning", message: "这条边今天已经存在" });
          return;
        }
        const id = newId("edge");
        try {
          await get().runWithHistory({
            label: type === "point" ? "建立指向" : "建立边",
            apply: async () => {
              await api.createEdge({ id, date, fromNodeId: from, toNodeId: to, type });
            },
            revert: async () => {
              await api.purgeEdge(id);
            },
          });
          await get().loadDay();
        } catch (error) {
          notifyError(error, "建立边失败");
        }
      },

      createEdgesFromSelection: async (type = "single") => {
        const ids = get().selectedNodeIds;
        if (ids.length < 2) {
          get().pushToast({ kind: "warning", message: "请先选中两个及以上节点" });
          return;
        }
        const date = get().currentDate;
        const groupId = ids.length > 2 ? newId("group") : null;
        const pairs: Array<{ id: string; from: string; to: string }> = [];
        for (let i = 0; i < ids.length; i += 1) {
          for (let j = i + 1; j < ids.length; j += 1) {
            pairs.push({ id: newId("edge"), from: ids[i], to: ids[j] });
          }
        }
        try {
          await get().runWithHistory({
            label: type === "point" ? "批量建立指向" : "批量建立边",
            apply: async () => {
              for (const pair of pairs) {
                await api.createEdge({
                  id: pair.id,
                  date,
                  fromNodeId: pair.from,
                  toNodeId: pair.to,
                  type,
                  groupId,
                });
              }
            },
            revert: async () => {
              for (const pair of pairs) {
                await api.purgeEdge(pair.id);
              }
            },
          });
          await get().loadDay();
        } catch (error) {
          notifyError(error, "批量建立边失败");
        }
      },

      deleteEdge: async (edgeId) => {
        try {
          await get().runWithHistory({
            label: "删除边",
            apply: async () => {
              await api.deleteEdge(edgeId);
            },
            revert: async () => {
              await api.restoreEdge(edgeId);
            },
          });
          await get().loadDay();
        } catch (error) {
          notifyError(error, "删除边失败");
        }
      },

      deleteSelectedEdges: async () => {
        const ids = get().selectedEdgeIds;
        if (ids.length === 0) return;
        try {
          await get().runWithHistory({
            label: `删除 ${ids.length} 条边`,
            apply: async () => {
              await api.deleteEdges(ids);
            },
            revert: async () => {
              for (const id of ids) {
                await api.restoreEdge(id);
              }
            },
          });
          set((s) => {
            s.selectedEdgeIds = [];
          });
          await get().loadDay();
        } catch (error) {
          notifyError(error, "删除边失败");
        }
      },

      copyEdgesToNextDay: async (edgeIds, continueInvisible = false) => {
        const fromDate = get().currentDate;
        try {
          const result = await api.copyEdgesToNextDay({
            fromDate,
            edgeIds: edgeIds && edgeIds.length > 0 ? edgeIds : null,
            continueInvisible,
          });
          set((s) => {
            s.copyResult = result;
          });
          if (result.batchId) {
            const batchId = result.batchId;
            const occIds = result.continuedOccurrenceIds ?? [];
            const continued = result.continuedNodes ?? [];
            await get().runWithHistory({
              label: `复制 ${result.copied.length} 条边到 ${result.toDate}`,
              apply: async () => {
                await api.restoreEdgeBatch(batchId);
                // 重做时把当时补的「仅次日」出现段一并补回来
                for (const node of continued) {
                  try {
                    await api.addOccurrence({
                      nodeId: node.id,
                      startDate: result.toDate,
                      endDate: result.toDate,
                      source: "manual",
                    });
                  } catch {
                    /* 已存在或节点已删除，忽略 */
                  }
                }
              },
              revert: async () => {
                await api.deleteEdgeBatch(batchId);
                for (const id of occIds) {
                  try {
                    await api.deleteOccurrence(id);
                  } catch {
                    /* 已被删除，忽略 */
                  }
                }
              },
            });
          }
          get().pushToast({
            kind: result.copied.length > 0 ? "success" : "warning",
            message:
              result.copied.length > 0
                ? `已复制 ${result.copied.length} 条边到 ${result.toDate}`
                : "没有可复制的边",
            detail:
              result.skippedInvisible.length > 0
                ? `${result.skippedInvisible.length} 条因端点次日不可见被跳过`
                : undefined,
          });
          await get().loadDay();
        } catch (error) {
          notifyError(error, "复制边失败");
        }
      },

      copyWithContinuation: async (edgeIds) => {
        await get().copyEdgesToNextDay(edgeIds, true);
      },

      undoCopyBatch: async (batchId) => {
        try {
          await api.deleteEdgeBatch(batchId);
          set((s) => {
            s.copyResult = null;
          });
          await get().loadDay();
          get().pushToast({ kind: "info", message: "已撤销本次复制" });
        } catch (error) {
          notifyError(error, "撤销复制失败");
        }
      },

      dismissCopyResult: () =>
        set((s) => {
          s.copyResult = null;
        }),

      // ---------------- 出现段 ----------------
      addOccurrence: async (nodeId, startDate, endDate, source = "manual") => {
        const holder: Holder<Occurrence> = { value: null };
        try {
          await get().runWithHistory({
            label: "新增出现段",
            apply: async () => {
              holder.value = await api.addOccurrence({
                nodeId,
                startDate,
                endDate: endDate ?? null,
                source,
                isManualReappear: source === "reappear",
              });
            },
            revert: async () => {
              if (holder.value) await api.deleteOccurrence(holder.value.id);
            },
          });
          await get().loadDay();
          await get().loadTimeline(nodeId);
        } catch (error) {
          notifyError(error, "新增出现段失败");
        }
      },

      deleteOccurrence: async (occurrenceId, nodeId) => {
        // 出现段是物理删除，撤销靠「按原字段重新插入」（id 会变，语义等价）
        const targetNodeId = nodeId ?? get().timeline?.node.id ?? null;
        let snapshot: Occurrence | null = null;
        if (targetNodeId) {
          try {
            const list = await api.listOccurrences(targetNodeId);
            snapshot = list.find((o) => o.id === occurrenceId) ?? null;
          } catch {
            snapshot = null;
          }
        }
        try {
          await get().runWithHistory({
            label: "删除出现段",
            apply: async () => {
              await api.deleteOccurrence(occurrenceId);
            },
            revert: async () => {
              if (!snapshot) throw new Error("缺少出现段快照，无法撤销");
              await api.addOccurrence({
                nodeId: snapshot.nodeId,
                startDate: snapshot.startDate,
                endDate: snapshot.endDate,
                source: snapshot.source,
                isManualReappear: snapshot.isManualReappear,
              });
            },
          });
          await get().loadDay();
          if (targetNodeId) await get().loadTimeline(targetNodeId);
        } catch (error) {
          notifyError(error, "删除出现段失败");
        }
      },

      continueToNextDay: async (nodeId) => {
        const holder: Holder<Occurrence> = { value: null };
        const from = get().currentDate;
        try {
          await get().runWithHistory({
            label: "手动延续到明天",
            apply: async () => {
              holder.value = await api.continueNodeToNextDay(nodeId, from, true);
            },
            revert: async () => {
              if (holder.value) await api.deleteOccurrence(holder.value.id);
            },
          });
          await get().loadDay();
          get().pushToast({ kind: "success", message: `已延续到 ${nextDate(from)}` });
        } catch (error) {
          notifyError(error, "延续失败");
        }
      },

      reappearToday: async (nodeId) => {
        const date = get().currentDate;
        const holder: Holder<Occurrence> = { value: null };
        try {
          await get().runWithHistory({
            label: "手动重新出现",
            apply: async () => {
              holder.value = await api.reappearNode(nodeId, date, true);
            },
            revert: async () => {
              if (holder.value) await api.deleteOccurrence(holder.value.id);
            },
          });
          await get().loadDay();
          await get().loadTimeline(nodeId);
          get().pushToast({ kind: "success", message: `已让节点在 ${date} 重新出现` });
        } catch (error) {
          notifyError(error, "重新出现失败");
        }
      },

      // ---------------- 布局 ----------------
      ensureLayouts: async () => {
        const view = get().dayView;
        if (!view || layoutSyncing) return;
        const rendered = get().renderableNodeIds();
        const existing = new Set(view.layouts.map((l) => l.nodeId));
        const missing = rendered.filter((id) => !existing.has(id));
        if (missing.length === 0) return;

        layoutSyncing = true;
        try {
          const maxY = view.layouts.reduce((acc, l) => Math.max(acc, l.y), 0);
          const computed = computeAutoLayout(
            missing,
            view.edges.map((e) => ({ from: e.edge.fromNodeId, to: e.edge.toNodeId })),
            { originY: view.layouts.length > 0 ? maxY + 160 : 80 },
          );
          const layouts: LayoutInput[] = Object.entries(computed).map(([nodeId, pos]) => ({
            nodeId,
            x: pos.x,
            y: pos.y,
            collapsed: false,
            level: null,
          }));
          await api.saveDayLayouts(view.date, layouts);
          const now = new Date().toISOString();
          set((s) => {
            if (!s.dayView || s.dayView.date !== view.date) return;
            for (const l of layouts) {
              s.dayView.layouts.push({
                date: view.date,
                nodeId: l.nodeId,
                x: l.x,
                y: l.y,
                collapsed: l.collapsed ?? false,
                zIndex: null,
                anchor: null,
                level: null,
                updatedAt: now,
              });
            }
          });
        } catch {
          // 自动布局失败不阻塞主流程
        } finally {
          layoutSyncing = false;
        }
      },

      setNodePosition: (nodeId, x, y) =>
        set((s) => {
          if (!s.dayView) return;
          const found = s.dayView.layouts.find((l) => l.nodeId === nodeId);
          if (found) {
            found.x = x;
            found.y = y;
            found.updatedAt = new Date().toISOString();
          } else {
            s.dayView.layouts.push({
              date: s.dayView.date,
              nodeId,
              x,
              y,
              collapsed: false,
              zIndex: null,
              anchor: null,
              level: null,
              updatedAt: new Date().toISOString(),
            });
          }
        }),

      beginLayoutDrag: (nodeIds) => {
        const view = get().dayView;
        if (!view) return;
        const before = view.layouts
          .filter((l) => nodeIds.includes(l.nodeId))
          .map((l) => ({ nodeId: l.nodeId, x: l.x, y: l.y }));
        set((s) => {
          s.pendingLayout = { nodeIds, before };
        });
      },

      commitLayoutDrag: async () => {
        const view = get().dayView;
        const snapshot = get().pendingLayout;
        if (!view || !snapshot) return;

        const after = view.layouts
          .filter((l) => snapshot.nodeIds.includes(l.nodeId))
          .map((l) => ({ nodeId: l.nodeId, x: l.x, y: l.y }));

        set((s) => {
          s.pendingLayout = null;
        });

        const changed = after.some((a) => {
          const b = snapshot.before.find((x) => x.nodeId === a.nodeId);
          return !b || Math.abs(b.x - a.x) > 0.5 || Math.abs(b.y - a.y) > 0.5;
        });
        if (!changed) return;

        const date = view.date;
        const toInputs = (list: Array<{ nodeId: string; x: number; y: number }>): LayoutInput[] =>
          list.map((p) => ({ nodeId: p.nodeId, x: p.x, y: p.y }));
        const beforeList = snapshot.before;

        try {
          await get().runWithHistory({
            label: "移动节点",
            apply: async () => {
              await api.saveDayLayouts(date, toInputs(after));
            },
            revert: async () => {
              if (beforeList.length > 0) {
                await api.saveDayLayouts(date, toInputs(beforeList));
              }
            },
            coalesceKey: `layout:${date}`,
          });
        } catch (error) {
          notifyError(error, "保存布局失败");
        }
      },

      resetLayout: async () => {
        const date = get().currentDate;
        try {
          await api.resetDayLayouts(date);
          set((s) => {
            if (s.dayView) s.dayView.layouts = [];
          });
          await get().ensureLayouts();
          get().pushToast({ kind: "info", message: "已重置当天布局" });
        } catch (error) {
          notifyError(error, "重置布局失败");
        }
      },

      autoArrange: async () => {
        const view = get().dayView;
        if (!view) return;
        const ids = get().renderableNodeIds();
        const computed = computeAutoLayout(
          ids,
          view.edges.map((e) => ({ from: e.edge.fromNodeId, to: e.edge.toNodeId })),
        );
        const layouts: LayoutInput[] = Object.entries(computed).map(([nodeId, pos]) => ({
          nodeId,
          x: pos.x,
          y: pos.y,
        }));
        const before: LayoutInput[] = view.layouts.map((l) => ({
          nodeId: l.nodeId,
          x: l.x,
          y: l.y,
        }));
        try {
          await get().runWithHistory({
            label: "自动排列",
            apply: async () => {
              await api.saveDayLayouts(view.date, layouts);
            },
            revert: async () => {
              await api.saveDayLayouts(view.date, before);
            },
          });
          await get().loadDay(view.date);
        } catch (error) {
          notifyError(error, "自动排列失败");
        }
      },

      // ---------------- 时间树 ----------------
      openDetail: async (nodeId, tab = "detail") => {
        set((s) => {
          s.detailNodeId = nodeId;
          s.rightTab = tab;
        });
        await Promise.all([get().loadTimeline(nodeId), get().loadFollowOverrides(nodeId)]);
      },

      setRightTab: (tab) =>
        set((s) => {
          s.rightTab = tab;
        }),

      closeDetail: () =>
        set((s) => {
          s.detailNodeId = null;
          s.timeline = null;
        }),

      loadTimeline: async (nodeId) => {
        set((s) => {
          s.timelineLoading = true;
        });
        try {
          const tree = await api.getNodeTimeTree(nodeId);
          set((s) => {
            s.timeline = tree;
          });
        } catch {
          set((s) => {
            s.timeline = null;
          });
        } finally {
          set((s) => {
            s.timelineLoading = false;
          });
        }
      },

      // ---------------- 阶段 2：跟随覆盖 ----------------
      loadFollowOverrides: async (nodeId) => {
        try {
          const list = await api.listFollowOverrides(nodeId);
          set((s) => {
            s.followOverrides = list;
          });
        } catch {
          set((s) => {
            s.followOverrides = [];
          });
        }
      },

      saveFollowOverride: async (input) => {
        try {
          const before =
            get().followOverrides.find(
              (f) => f.nodeId === input.nodeId && f.parentId === input.parentId,
            ) ?? null;
          await get().runWithHistory({
            label: "设置子节点跟随模式",
            apply: async () => {
              await api.setFollowOverride(input);
            },
            revert: async () => {
              if (before) {
                await api.setFollowOverride({
                  nodeId: before.nodeId,
                  parentId: before.parentId,
                  mode: before.mode,
                  startDate: before.startDate,
                  endDate: before.endDate,
                });
              } else {
                await api.deleteFollowOverride(input.nodeId, input.parentId);
              }
            },
          });
          await get().loadFollowOverrides(input.nodeId);
          await get().loadDay();
        } catch (error) {
          notifyError(error, "保存跟随模式失败");
        }
      },

      deleteFollowOverride: async (nodeId, parentId) => {
        try {
          const before =
            get().followOverrides.find(
              (f) => f.nodeId === nodeId && f.parentId === parentId,
            ) ?? null;
          await get().runWithHistory({
            label: "清除跟随覆盖",
            apply: async () => {
              await api.deleteFollowOverride(nodeId, parentId);
            },
            revert: async () => {
              if (before) {
                await api.setFollowOverride({
                  nodeId: before.nodeId,
                  parentId: before.parentId,
                  mode: before.mode,
                  startDate: before.startDate,
                  endDate: before.endDate,
                });
              }
            },
          });
          await get().loadFollowOverrides(nodeId);
          await get().loadDay();
        } catch (error) {
          notifyError(error, "清除跟随覆盖失败");
        }
      },

      setDayForceVisible: async (nodeId, force) => {
        const date = get().currentDate;
        try {
          const before = await api.getDayOverlay(nodeId, date);
          await get().runWithHistory({
            label: force ? "临时可见（仅当天）" : "取消临时可见",
            apply: async () => {
              await api.setDayForceVisible(nodeId, date, force);
            },
            revert: async () => {
              if (before) {
                await api.saveDayOverlay({
                  nodeId: before.nodeId,
                  date: before.date,
                  title: before.title,
                  content: before.content,
                  visible: before.visible,
                  forceVisible: before.forceVisible,
                  sortOrder: before.sortOrder,
                  styleJson: before.styleJson,
                });
              } else {
                await api.clearDayOverlay(nodeId, date);
              }
            },
          });
          await get().loadDay();
        } catch (error) {
          notifyError(error, "设置临时可见失败");
        }
      },

      // ---------------- 阶段 2：历史与快照 ----------------
      loadHistory: async () => {
        try {
          const [operations, snapshots] = await Promise.all([
            api.listOperations({ limit: 300 }),
            api.listSnapshots(),
          ]);
          set((s) => {
            s.operations = operations;
            s.snapshots = snapshots;
          });
        } catch (error) {
          notifyError(error, "加载历史失败");
        }
      },

      createSnapshot: async () => {
        const date = get().currentDate;
        try {
          const snap = await api.createSnapshot(date);
          set((s) => {
            s.snapshots = [snap, ...s.snapshots.filter((x) => x.date !== snap.date)];
          });
          get().pushToast({
            kind: "success",
            message: `已为 ${date} 生成快照`,
            detail: `${snap.nodeCount} 节点 / ${snap.edgeCount} 边 / ${snap.overlayCount} 覆盖`,
          });
          await get().loadHistory();
        } catch (error) {
          notifyError(error, "生成快照失败");
        }
      },

      restoreSnapshot: async (date) => {
        try {
          const result = await api.restoreSnapshot(date);
          get().pushToast({
            kind: "success",
            message: `已恢复 ${date} 的快照`,
            detail: `边 ${result.restoredEdges} / 覆盖 ${result.restoredOverlays} / 布局 ${result.restoredLayouts}`,
          });
          await get().loadDay();
          await get().loadHistory();
        } catch (error) {
          notifyError(error, "恢复快照失败");
        }
      },

      deleteSnapshot: async (date) => {
        try {
          await api.deleteSnapshot(date);
          set((s) => {
            s.snapshots = s.snapshots.filter((x) => x.date !== date);
          });
        } catch (error) {
          notifyError(error, "删除快照失败");
        }
      },

      // ---------------- 阶段 2：指向 ----------------
      openPointDialog: () => {
        if (get().selectedNodeIds.length === 0) {
          get().pushToast({ kind: "warning", message: "请先选中要被指向的节点" });
          return;
        }
        set((s) => {
          s.pointDialogOpen = true;
        });
      },

      closePointDialog: () =>
        set((s) => {
          s.pointDialogOpen = false;
        }),

      confirmPoint: async (targetId, newTitle, forceVisible) => {
        const sources = get().selectedNodeIds.filter((id) => id !== targetId);
        if (sources.length === 0) {
          get().pushToast({ kind: "warning", message: "至少要选一个来源节点" });
          return;
        }
        const date = get().currentDate;
        try {
          let target = targetId;
          if (!target) {
            target = await get().createNode({ title: newTitle?.trim() || "汇总节点" });
          }
          if (!target) return;

          const edgeIds: string[] = [];
          await get().runWithHistory({
            label: `建立 ${sources.length} 条指向`,
            apply: async () => {
              if (forceVisible) {
                await api.setDayForceVisible(target!, date, true);
              }
              for (const from of sources) {
                const id = newId("edge");
                edgeIds.push(id);
                await api.createEdge({
                  id,
                  date,
                  fromNodeId: from,
                  toNodeId: target!,
                  type: "point",
                });
              }
            },
            revert: async () => {
              for (const id of edgeIds) {
                try {
                  await api.purgeEdge(id);
                } catch {
                  /* 已删除 */
                }
              }
              if (forceVisible) {
                try {
                  await api.clearDayOverlay(target!, date);
                } catch {
                  /* 忽略 */
                }
              }
            },
          });
          set((s) => {
            s.pointDialogOpen = false;
            s.selectedNodeIds = [target!];
            s.detailNodeId = target;
            s.rightTab = "detail";
          });
          await get().loadDay();
          get().pushToast({
            kind: "success",
            message: `已建立 ${sources.length} 条指向`,
            detail: forceVisible ? "目标节点已设为当天临时可见" : undefined,
          });
        } catch (error) {
          notifyError(error, "建立指向失败");
        }
      },

      // ---------------- 撤销 / 重做 ----------------
      runWithHistory,

      undo: async () => {
        const stack = get().undoStack;
        if (stack.length === 0 || get().historyBusy) return;
        const entry = stack[stack.length - 1];
        set((s) => {
          s.historyBusy = true;
        });
        try {
          await entry.revert();
          set((s) => {
            s.undoStack.pop();
            s.redoStack.push(entry);
          });
          await get().loadDay();
          await get().refreshNodeList();
          get().pushToast({ kind: "info", message: `已撤销：${entry.label}` });
        } catch (error) {
          notifyError(error, "撤销失败");
        } finally {
          set((s) => {
            s.historyBusy = false;
          });
        }
      },

      redo: async () => {
        const stack = get().redoStack;
        if (stack.length === 0 || get().historyBusy) return;
        const entry = stack[stack.length - 1];
        set((s) => {
          s.historyBusy = true;
        });
        try {
          await entry.apply();
          set((s) => {
            s.redoStack.pop();
            s.undoStack.push(entry);
          });
          await get().loadDay();
          await get().refreshNodeList();
          get().pushToast({ kind: "info", message: `已重做：${entry.label}` });
        } catch (error) {
          notifyError(error, "重做失败");
        } finally {
          set((s) => {
            s.historyBusy = false;
          });
        }
      },

      // ---------------- 杂项 ----------------
      pushToast: (toast) =>
        set((s) => {
          s.toasts.push({ ...toast, id: newId("toast") });
          if (s.toasts.length > 4) s.toasts.shift();
        }),

      dismissToast: (id) =>
        set((s) => {
          s.toasts = s.toasts.filter((t) => t.id !== id);
        }),

      setError: (message) =>
        set((s) => {
          s.error = message;
        }),

      setSettingValue: async (key, value) => {
        try {
          const settings = await api.setSetting(key, value);
          set((s) => {
            s.settings = settings;
          });
        } catch (error) {
          notifyError(error, "保存设置失败");
        }
      },

      updateAppInfo: (info) =>
        set((s) => {
          s.appInfo = info;
        }),

      setShowHidden: (value) => {
        set((s) => {
          s.showHidden = value;
        });
        void get().setSettingValue("ui.show_hidden", value ? "1" : "0");
      },

      setSearchKeyword: (value) =>
        set((s) => {
          s.searchKeyword = value;
        }),

      setStarredOnly: (value) =>
        set((s) => {
          s.starredOnly = value;
        }),

      toggleStatusFilter: (status) =>
        set((s) => {
          s.statusFilter = s.statusFilter.includes(status)
            ? s.statusFilter.filter((v) => v !== status)
            : [...s.statusFilter, status];
        }),

      setListScope: (scope) =>
        set((s) => {
          s.listScope = scope;
        }),

      setSettingsOpen: (open) =>
        set((s) => {
          s.settingsOpen = open;
        }),

      toggleConnectMode: () =>
        set((s) => {
          s.connectMode = !s.connectMode;
          s.connectSourceId = null;
        }),

      setConnectSource: (nodeId) =>
        set((s) => {
          s.connectSourceId = nodeId;
        }),

      setSelectedNodes: (ids) =>
        set((s) => {
          s.selectedNodeIds = ids;
        }),

      setSelectedEdges: (ids) =>
        set((s) => {
          s.selectedEdgeIds = ids;
        }),

      selectAllVisible: () =>
        set((s) => {
          if (!s.dayView) return;
          s.selectedNodeIds = s.dayView.nodes.map((n) => n.node.id);
        }),

      clearSelection: () =>
        set((s) => {
          s.selectedNodeIds = [];
          s.selectedEdgeIds = [];
          s.connectSourceId = null;
        }),
    };
  }),
);

/** 便捷选择器 */
export const selectCanUndo = (s: AppStore) => s.undoStack.length > 0;
export const selectCanRedo = (s: AppStore) => s.redoStack.length > 0;
export const selectNextUndoLabel = (s: AppStore) =>
  s.undoStack.length > 0 ? s.undoStack[s.undoStack.length - 1].label : null;
export const selectNextRedoLabel = (s: AppStore) =>
  s.redoStack.length > 0 ? s.redoStack[s.redoStack.length - 1].label : null;
export type { DayView };
