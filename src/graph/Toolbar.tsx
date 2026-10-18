/** 画布浮动工具栏（需求 7.2）。 */

import {
  Copy,
  Eye,
  EyeOff,
  LayoutGrid,
  Link2,
  Plus,
  RotateCcw,
  Target,
  Trash2,
  Workflow,
} from "lucide-react";

import { cn } from "@/lib/util";
import { useAppStore } from "@/store/useAppStore";

export function Toolbar() {
  const dayView = useAppStore((s) => s.dayView);
  const connectMode = useAppStore((s) => s.connectMode);
  const showHidden = useAppStore((s) => s.showHidden);
  const selectedNodeIds = useAppStore((s) => s.selectedNodeIds);
  const selectedEdgeIds = useAppStore((s) => s.selectedEdgeIds);

  const hiddenCount = dayView?.hidden.length ?? 0;
  const edgeCount = dayView?.edges.length ?? 0;
  const nodeCount = dayView?.nodes.length ?? 0;
  const hasSelection = selectedNodeIds.length > 0 || selectedEdgeIds.length > 0;

  return (
    <div className="absolute left-4 top-4 z-10 flex flex-col gap-2">
      <div className="flex items-center gap-1 rounded-xl border border-zinc-200 bg-white/95 p-1 shadow-sm backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95">
        <button
          type="button"
          className="btn btn-primary"
          title="新建节点（N）"
          onClick={() => void useAppStore.getState().createNode()}
        >
          <Plus className="h-3.5 w-3.5" />
          新建
        </button>

        <button
          type="button"
          className={cn("btn", connectMode && "!border-amber-400 !bg-amber-50 dark:!bg-amber-950")}
          title="连线模式（E）：点击起点再点击终点"
          onClick={() => useAppStore.getState().toggleConnectMode()}
        >
          <Link2 className="h-3.5 w-3.5" />
          连线
        </button>

        <button
          type="button"
          className="btn"
          title={`把选中的 ${selectedNodeIds.length} 个节点两两连起来`}
          disabled={selectedNodeIds.length < 2}
          onClick={() => void useAppStore.getState().createEdgesFromSelection("single")}
        >
          <Workflow className="h-3.5 w-3.5" />
          连成边
        </button>

        <button
          type="button"
          className="btn"
          title={`让选中的 ${selectedNodeIds.length} 个节点共同指向一个独立节点 C（需求 4.4 指向）`}
          disabled={selectedNodeIds.length < 1}
          onClick={() => useAppStore.getState().openPointDialog()}
        >
          <Target className="h-3.5 w-3.5" />
          指向
        </button>

        <div className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-700" />

        <button
          type="button"
          className="btn"
          title={
            selectedEdgeIds.length > 0
              ? `复制选中的 ${selectedEdgeIds.length} 条边到明天（C）`
              : `复制今天全部 ${edgeCount} 条边到明天（C）`
          }
          disabled={edgeCount === 0}
          onClick={() =>
            void useAppStore
              .getState()
              .copyEdgesToNextDay(selectedEdgeIds.length > 0 ? selectedEdgeIds : undefined)
          }
        >
          <Copy className="h-3.5 w-3.5" />
          复制到明天
          {selectedEdgeIds.length > 0 && (
            <span className="ml-0.5 rounded bg-brand-100 px-1 text-[10px] text-brand-700 dark:bg-brand-900 dark:text-brand-200">
              {selectedEdgeIds.length}
            </span>
          )}
        </button>

        <button
          type="button"
          className="btn btn-danger"
          title="删除选中的节点或边（Delete）"
          disabled={!hasSelection}
          onClick={() => {
            const store = useAppStore.getState();
            if (store.selectedEdgeIds.length > 0 && store.selectedNodeIds.length === 0) {
              void store.deleteSelectedEdges();
              return;
            }
            void (async () => {
              const ids = [...store.selectedNodeIds];
              for (const id of ids) {
                await store.deleteNode(id);
              }
            })();
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
          删除
        </button>

        <div className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-700" />

        <button
          type="button"
          className="btn btn-ghost"
          title="按边关系自动排列"
          onClick={() => void useAppStore.getState().autoArrange()}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          title="清空当天布局并重新自动布局"
          onClick={() => void useAppStore.getState().resetLayout()}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={cn("btn btn-ghost", showHidden && "!bg-zinc-100 dark:!bg-zinc-800")}
          title={`显示/隐藏被判定为不可见的节点（H）${hiddenCount > 0 ? `，当前 ${hiddenCount} 个` : ""}`}
          onClick={() => useAppStore.getState().setShowHidden(!showHidden)}
        >
          {showHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        </button>
      </div>

      <div className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white/80 px-2.5 py-1 text-[11px] text-zinc-500 backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-400">
        <span>可见 {nodeCount}</span>
        <span>隐藏 {hiddenCount}</span>
        <span>边 {edgeCount}</span>
        {selectedNodeIds.length > 0 && <span className="text-brand-600 dark:text-brand-300">已选 {selectedNodeIds.length}</span>}
        {selectedEdgeIds.length > 0 && <span className="text-brand-600 dark:text-brand-300">选中边 {selectedEdgeIds.length}</span>}
      </div>
    </div>
  );
}
