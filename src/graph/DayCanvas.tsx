/** 当天图（React Flow 画布）。 */

import { useCallback, useEffect, useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type NodeMouseHandler,
} from "@xyflow/react";

import { useAppStore } from "@/store/useAppStore";
import type { DayNode, NodeStatus } from "@/types";

import { DayEdgeView } from "./DayEdgeView";
import { NodeCard } from "./NodeCard";
import { Toolbar } from "./Toolbar";
import { EDGE_TYPE, NODE_TYPE, type TTEdge, type TTNode } from "./types";

const nodeTypes = { [NODE_TYPE]: NodeCard };
const edgeTypes = { [EDGE_TYPE]: DayEdgeView };

function DayCanvasInner() {
  const dayView = useAppStore((s) => s.dayView);
  const previews = useAppStore((s) => s.previews);
  const showHidden = useAppStore((s) => s.showHidden);
  const selectedNodeIds = useAppStore((s) => s.selectedNodeIds);
  const selectedEdgeIds = useAppStore((s) => s.selectedEdgeIds);
  const connectMode = useAppStore((s) => s.connectMode);
  const connectSourceId = useAppStore((s) => s.connectSourceId);
  const loading = useAppStore((s) => s.loading);
  const { fitView } = useReactFlow();

  // ---------------- 稳定回调（通过 getState 取值，避免闭包过期） ----------------
  const onToggleStatus = useCallback((id: string, status: NodeStatus) => {
    void useAppStore.getState().setNodeStatus(id, status);
  }, []);
  const onToggleStar = useCallback((id: string) => {
    void useAppStore.getState().toggleStar(id);
  }, []);
  const onContinue = useCallback((id: string) => {
    void useAppStore.getState().continueToNextDay(id);
  }, []);
  const onOpenDetail = useCallback((id: string) => {
    void useAppStore.getState().openDetail(id, "detail");
  }, []);
  const onSetVisible = useCallback((id: string, visible: boolean) => {
    void useAppStore.getState().setDayVisible(id, visible);
  }, []);
  const onConnectPick = useCallback((id: string) => {
    const store = useAppStore.getState();
    const source = store.connectSourceId;
    if (!source) {
      store.setConnectSource(id);
      store.pushToast({ kind: "info", message: "已选择起点，再点击另一个节点完成连线" });
      return;
    }
    if (source === id) {
      store.setConnectSource(null);
      return;
    }
    void store.createEdgeBetween(source, id, "single");
    store.setConnectSource(null);
  }, []);

  // ---------------- 节点 ----------------
  const rfNodes = useMemo<TTNode[]>(() => {
    if (!dayView) return [];
    const layoutMap = new Map(dayView.layouts.map((l) => [l.nodeId, l]));
    const list: TTNode[] = [];

    const build = (id: string, dayNode: DayNode, hiddenOnly: boolean): TTNode => {
      const layout = layoutMap.get(id);
      return {
        id,
        type: NODE_TYPE,
        position: { x: layout?.x ?? 0, y: layout?.y ?? 0 },
        selected: selectedNodeIds.includes(id),
        data: {
          dayNode,
          preview: previews[id] ?? dayNode.overlayContentPreview ?? "",
          hiddenOnly,
          connectSource: connectSourceId === id,
          connectMode,
          onToggleStatus,
          onToggleStar,
          onContinue,
          onOpenDetail,
          onSetVisible,
          onConnectPick,
        },
      };
    };

    for (const dn of dayView.nodes) {
      list.push(build(dn.node.id, dn, false));
    }
    if (showHidden) {
      for (const hn of dayView.hidden) {
        list.push(
          build(hn.node.id, {
            node: hn.node,
            displayTitle: hn.node.title,
            overlay: null,
            hasOverlayContent: false,
            overlayContentPreview: null,
            visibility: hn.visibility,
            occurrence: null,
            continuedFrom: null,
            dayIndex: null,
          }, true),
        );
      }
    }
    return list;
  }, [
    dayView,
    previews,
    showHidden,
    selectedNodeIds,
    connectSourceId,
    connectMode,
    onToggleStatus,
    onToggleStar,
    onContinue,
    onOpenDetail,
    onSetVisible,
    onConnectPick,
  ]);

  // ---------------- 边 ----------------
  const rfEdges = useMemo<TTEdge[]>(() => {
    if (!dayView) return [];
    const rendered = new Set(rfNodes.map((n) => n.id));
    const titleOf = (id: string) =>
      dayView.nodes.find((n) => n.node.id === id)?.displayTitle ??
      dayView.hidden.find((n) => n.node.id === id)?.node.title ??
      id;

    return dayView.edges
      .filter((e) => rendered.has(e.edge.fromNodeId) && rendered.has(e.edge.toNodeId))
      .map<TTEdge>((e) => {
        const color = e.edge.type === "point" ? "#8b5cf6" : "#71717a";
        return {
          id: e.edge.id,
          source: e.edge.fromNodeId,
          target: e.edge.toNodeId,
          type: EDGE_TYPE,
          selected: selectedEdgeIds.includes(e.edge.id),
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color },
          markerStart: e.bidirectional
            ? { type: MarkerType.ArrowClosed, width: 16, height: 16, color }
            : undefined,
          data: {
            view: e,
            fromTitle: titleOf(e.edge.fromNodeId),
            toTitle: titleOf(e.edge.toNodeId),
            onDelete: (id: string) => void useAppStore.getState().deleteEdge(id),
          },
        };
      });
  }, [dayView, rfNodes, selectedEdgeIds]);

  // ---------------- 事件 ----------------
  const onNodesChange = useCallback((changes: NodeChange<TTNode>[]) => {
    const store = useAppStore.getState();
    let selectionTouched = false;
    for (const change of changes) {
      if (change.type === "position" && change.position) {
        store.setNodePosition(change.id, change.position.x, change.position.y);
      } else if (change.type === "select") {
        selectionTouched = true;
      }
    }
    if (selectionTouched) {
      const next = new Set(store.selectedNodeIds);
      for (const change of changes) {
        if (change.type === "select") {
          if (change.selected) next.add(change.id);
          else next.delete(change.id);
        }
      }
      store.setSelectedNodes([...next]);
    }
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange<TTEdge>[]) => {
    const store = useAppStore.getState();
    for (const change of changes) {
      if (change.type === "remove") {
        void store.deleteEdge(change.id);
      } else if (change.type === "select") {
        const next = new Set(store.selectedEdgeIds);
        if (change.selected) next.add(change.id);
        else next.delete(change.id);
        store.setSelectedEdges([...next]);
      }
    }
  }, []);

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    void useAppStore.getState().createEdgeBetween(connection.source, connection.target, "single");
  }, []);

  const onNodeClick: NodeMouseHandler<TTNode> = useCallback(
    (_event, node) => {
      const store = useAppStore.getState();
      if (store.connectMode) onConnectPick(node.id);
    },
    [onConnectPick],
  );

  const onNodeDoubleClick: NodeMouseHandler<TTNode> = useCallback((_event, node) => {
    void useAppStore.getState().openDetail(node.id, "detail");
  }, []);

  const onPaneClick = useCallback(() => {
    useAppStore.getState().clearSelection();
  }, []);

  const onNodeDragStart = useCallback((_event: unknown, node: TTNode, nodes: TTNode[]) => {
    const ids = nodes.filter((n) => n.selected).map((n) => n.id);
    useAppStore.getState().beginLayoutDrag(ids.length > 0 ? ids : [node.id]);
  }, []);

  const onNodeDragStop = useCallback(() => {
    void useAppStore.getState().commitLayoutDrag();
  }, []);

  // 切换日期后自动适配视口
  const date = dayView?.date;
  useEffect(() => {
    if (!date) return;
    const timer = setTimeout(() => {
      void fitView({ padding: 0.22, duration: 260, maxZoom: 1.1 });
    }, 90);
    return () => clearTimeout(timer);
  }, [date, fitView]);

  return (
    <div className="relative h-full w-full">
      <ReactFlow<TTNode, TTEdge>
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onPaneClick={onPaneClick}
        deleteKeyCode={null}
        multiSelectionKeyCode={["Meta", "Control", "Shift"]}
        selectionKeyCode="Shift"
        panOnDrag={[1, 2]}
        selectionOnDrag
        minZoom={0.15}
        maxZoom={2.2}
        defaultEdgeOptions={{ type: EDGE_TYPE }}
        proOptions={{ hideAttribution: true }}
        className="bg-zinc-50 dark:bg-zinc-950"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={18}
          size={1}
          className="text-zinc-300 dark:text-zinc-700"
        />
        <Controls showInteractive={false} className="!bottom-4 !left-4" />
        <MiniMap
          pannable
          zoomable
          className="!bottom-4 !right-4 !h-24 !w-40 rounded-lg border border-zinc-200 dark:border-zinc-700"
          nodeColor={(n) => {
            const status = (n.data as TTNode["data"] | undefined)?.dayNode?.node?.status as
              | NodeStatus
              | undefined;
            if (!status) return "#a1a1aa";
            switch (status) {
              case "doing":
                return "#60a5fa";
              case "done":
                return "#34d399";
              case "cancelled":
                return "#d4d4d8";
              default:
                return "#a1a1aa";
            }
          }}
          maskColor="rgba(0,0,0,.06)"
        />
      </ReactFlow>

      <Toolbar />

      {!loading && dayView && dayView.nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="pointer-events-auto max-w-sm rounded-2xl border border-dashed border-zinc-300 bg-white/80 p-6 text-center backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/80">
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
              {dayView.date} 还没有节点
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              新建的节点默认「自动延续」，未完成时会一直往后缘延。
            </p>
            <button
              type="button"
              className="btn btn-primary mt-3"
              onClick={() => void useAppStore.getState().createNode()}
            >
              新建第一个节点
            </button>
          </div>
        </div>
      )}

      {loading && (
        <div className="absolute right-4 top-4 rounded-full border border-zinc-200 bg-white/90 px-3 py-1 text-[11px] text-zinc-500 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/90 dark:text-zinc-400">
          加载中…
        </div>
      )}

      {connectMode && (
        <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-[11px] text-amber-700 shadow-sm dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
          {connectSourceId
            ? "已选择起点：点击另一个节点完成连线（Esc 取消）"
            : "连线模式：点击起点节点（也可直接拖拽节点右侧圆点）"}
        </div>
      )}
    </div>
  );
}

export function DayCanvas() {
  return (
    <ReactFlowProvider>
      <DayCanvasInner />
    </ReactFlowProvider>
  );
}
