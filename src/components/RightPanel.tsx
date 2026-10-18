/** 右侧面板容器：详情 / 时间树切换。 */

import { Clock3, History, PanelRightClose, SlidersHorizontal } from "lucide-react";

import { cn } from "@/lib/util";
import { useAppStore } from "@/store/useAppStore";

import { HistoryPanel } from "./HistoryPanel";
import { NodeDetailPanel } from "./NodeDetailPanel";
import { TimeTreePanel } from "./TimeTreePanel";

export function RightPanel() {
  const detailNodeId = useAppStore((s) => s.detailNodeId);
  const rightTab = useAppStore((s) => s.rightTab);

  return (
    <aside className="flex w-[372px] shrink-0 flex-col border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-1 border-b border-zinc-100 px-2 py-1.5 dark:border-zinc-800">
        {(
          [
            ["detail", "详情", SlidersHorizontal],
            ["timeline", "时间树", Clock3],
            ["history", "历史", History],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            className={cn(
              "flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition",
              rightTab === value
                ? "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
                : "text-zinc-500 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800/60",
            )}
            onClick={() => useAppStore.getState().setRightTab(value)}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
        <button
          type="button"
          className="btn btn-ghost !px-1"
          title="关闭面板"
          onClick={() => useAppStore.getState().closeDetail()}
        >
          <PanelRightClose className="h-3.5 w-3.5" />
        </button>
      </div>

      {rightTab === "history" ? (
        <HistoryPanel />
      ) : !detailNodeId ? (
        <div className="flex h-full items-center justify-center px-6 text-center text-xs leading-relaxed text-zinc-400">
          未选中节点。
          <br />
          双击图中节点，或点击左侧列表中的节点查看详情。
        </div>
      ) : rightTab === "detail" ? (
        <NodeDetailPanel />
      ) : (
        <TimeTreePanel />
      )}
    </aside>
  );
}
