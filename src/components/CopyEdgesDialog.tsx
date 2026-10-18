/** 复制边结果汇总弹窗（需求 4.2.8 第 5-7 步）。 */

import { ArrowRight, CheckCircle2, Copy, Info, X } from "lucide-react";

import { VISIBILITY_META } from "@/lib/labels";
import { cn } from "@/lib/util";
import { useAppStore } from "@/store/useAppStore";

export function CopyEdgesDialog() {
  const result = useAppStore((s) => s.copyResult);
  const dismiss = useAppStore((s) => s.dismissCopyResult);
  if (!result) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/20 p-6 backdrop-blur-sm">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <Copy className="h-4 w-4 text-brand-500" />
            <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              复制边到明天
            </h2>
            <span className="flex items-center gap-1 text-xs text-zinc-500">
              {result.fromDate}
              <ArrowRight className="h-3 w-3" />
              {result.toDate}
            </span>
          </div>
          <button type="button" className="btn btn-ghost !px-1.5" onClick={dismiss}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-4 py-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-emerald-50 px-2 py-2 dark:bg-emerald-950/60">
              <div className="text-lg font-semibold text-emerald-700 dark:text-emerald-300">
                {result.copied.length}
              </div>
              <div className="text-[10px] text-emerald-600 dark:text-emerald-400">已复制</div>
            </div>
            <div className="rounded-lg bg-amber-50 px-2 py-2 dark:bg-amber-950/60">
              <div className="text-lg font-semibold text-amber-700 dark:text-amber-300">
                {result.skippedInvisible.length}
              </div>
              <div className="text-[10px] text-amber-600 dark:text-amber-400">端点不可见跳过</div>
            </div>
            <div className="rounded-lg bg-zinc-100 px-2 py-2 dark:bg-zinc-800">
              <div className="text-lg font-semibold text-zinc-600 dark:text-zinc-300">
                {result.skippedDuplicate}
              </div>
              <div className="text-[10px] text-zinc-500">明天已存在</div>
            </div>
          </div>

          {result.continuedNodes.length > 0 && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
              <CheckCircle2 className="mr-1 inline h-3 w-3" />
              已为 {result.continuedNodes.length} 个节点补了一天出现段（仅次日）：
              {result.continuedNodes.map((n) => n.title).join("、")}
            </div>
          )}

          {result.skippedInvisible.length > 0 && (
            <div>
              <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                <Info className="h-3 w-3" />
                以下边因端点明天不可见被跳过（可点下方「批量延续并复制」）
              </p>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-zinc-200 p-2 dark:border-zinc-700">
                {result.skippedInvisible.map((info) => (
                  <div
                    key={info.edge.id}
                    className="flex items-center gap-2 rounded px-1.5 py-1 text-[11px] odd:bg-zinc-50 dark:odd:bg-zinc-800/60"
                  >
                    <span className="truncate text-zinc-700 dark:text-zinc-200">
                      {info.fromTitle}
                    </span>
                    <ArrowRight className="h-3 w-3 shrink-0 text-zinc-400" />
                    <span className="truncate text-zinc-700 dark:text-zinc-200">
                      {info.toTitle}
                    </span>
                    <span className="ml-auto shrink-0 rounded bg-amber-100 px-1 text-[10px] text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                      {!info.fromVisible
                        ? `起点：${VISIBILITY_META[info.fromReason]?.label ?? info.fromReason}`
                        : `终点：${VISIBILITY_META[info.toReason]?.label ?? info.toReason}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.copied.length > 0 && (
            <div>
              <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-3 w-3" />
                已复制（批次 {result.batchId?.slice(0, 14)}…，可一键撤销）
              </p>
              <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-zinc-200 p-2 dark:border-zinc-700">
                {result.copied.map((edge) => (
                  <div key={edge.id} className="truncate px-1.5 py-0.5 text-[11px] text-zinc-600 dark:text-zinc-300">
                    {edge.fromNodeId.slice(0, 10)} → {edge.toNodeId.slice(0, 10)}
                    {edge.type === "point" && (
                      <span className="ml-1 text-violet-500">指向</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
          {result.skippedInvisible.length > 0 && (
            <button
              type="button"
              className="btn"
              title="为这些端点补一个仅次日的出现段，然后重新复制"
              onClick={() =>
                void useAppStore
                  .getState()
                  .copyWithContinuation(result.skippedInvisible.map((i) => i.edge.id))
              }
            >
              批量延续并复制
            </button>
          )}
          {result.batchId && (
            <button
              type="button"
              className={cn("btn btn-danger")}
              onClick={() => void useAppStore.getState().undoCopyBatch(result.batchId!)}
            >
              撤销本次复制
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={dismiss}>
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}
