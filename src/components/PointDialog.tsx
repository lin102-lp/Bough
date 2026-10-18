/** 「指向」对话框（阶段 2，需求 4.4）：多选节点 → 共同指向一个独立节点 C。 */

import { useMemo, useState } from "react";
import { ArrowRight, Eye, Plus, Target, X } from "lucide-react";

import { STATUS_META } from "@/lib/labels";
import { cn } from "@/lib/util";
import { useAppStore } from "@/store/useAppStore";

type Mode = "existing" | "new";

export function PointDialog() {
  const open = useAppStore((s) => s.pointDialogOpen);
  const selected = useAppStore((s) => s.selectedNodeIds);
  const dayView = useAppStore((s) => s.dayView);
  const [mode, setMode] = useState<Mode>("existing");
  const [targetId, setTargetId] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [forceVisible, setForceVisible] = useState(true);
  const [keyword, setKeyword] = useState("");

  const visibleCandidates = useMemo(() => {
    if (!dayView) return [];
    return dayView.nodes
      .filter((n) => !selected.includes(n.node.id))
      .filter((n) => !keyword || n.displayTitle.includes(keyword));
  }, [dayView, selected, keyword]);

  const hiddenCandidates = useMemo(() => {
    if (!dayView) return [];
    return dayView.hidden
      .filter((n) => !selected.includes(n.node.id))
      .filter((n) => !keyword || n.node.title.includes(keyword))
      .slice(0, 30);
  }, [dayView, selected, keyword]);

  if (!open) return null;

  const close = () => useAppStore.getState().closePointDialog();
  const targetIsHidden = hiddenCandidates.some((n) => n.node.id === targetId);
  const canConfirm =
    selected.length > 1 || (selected.length === 1 && (mode === "new" || targetId !== ""));

  const confirm = () => {
    if (mode === "new") {
      void useAppStore.getState().confirmPoint(null, newTitle, forceVisible);
    } else if (targetId) {
      void useAppStore.getState().confirmPoint(targetId, null, forceVisible || targetIsHidden);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/20 p-6 backdrop-blur-sm">
      <div className="flex max-h-[84vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-violet-500" />
            <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              指向一个独立节点 C
            </h2>
          </div>
          <button type="button" className="btn btn-ghost !px-1.5" onClick={close}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {/* 来源 */}
          <div>
            <p className="mb-1 text-[11px] font-medium text-zinc-500">
              来源节点（{selected.length}）· 原节点会保留，C 的内容独立维护
            </p>
            <div className="flex flex-wrap gap-1">
              {selected.map((id) => {
                const dn = dayView?.nodes.find((n) => n.node.id === id);
                return (
                  <span
                    key={id}
                    className="badge border border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                  >
                    {dn?.displayTitle ?? id.slice(0, 10)}
                  </span>
                );
              })}
            </div>
          </div>

          {/* 目标模式 */}
          <div className="flex gap-1">
            {(
              [
                ["existing", "选择已有节点"],
                ["new", "新建目标节点 C"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={cn(
                  "flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition",
                  mode === value
                    ? "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300"
                    : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800",
                )}
                onClick={() => setMode(value)}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === "new" ? (
            <div>
              <label className="label">目标节点标题</label>
              <input
                className="input"
                autoFocus
                placeholder="例如：写综述（汇总）"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
              <p className="mt-1 text-[10px] text-zinc-400">
                新建的 C 会出现在当天，来源节点通过「指向」边连到它（边只属于今天）。
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <input
                className="input"
                placeholder="搜索节点…"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
              <div className="max-h-52 space-y-1 overflow-y-auto">
                {visibleCandidates.map((dn) => (
                  <label
                    key={dn.node.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1 text-[12px] transition",
                      targetId === dn.node.id
                        ? "border-violet-400 bg-violet-50 dark:bg-violet-950/50"
                        : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800/60",
                    )}
                  >
                    <input
                      type="radio"
                      name="point-target"
                      className="accent-violet-600"
                      checked={targetId === dn.node.id}
                      onChange={() => setTargetId(dn.node.id)}
                    />
                    <span className={cn("h-2 w-2 rounded-full", STATUS_META[dn.node.status].dot)} />
                    <span className="truncate">{dn.displayTitle}</span>
                    <span className="ml-auto text-[10px] text-zinc-400">
                      {STATUS_META[dn.node.status].label}
                    </span>
                  </label>
                ))}
                {visibleCandidates.length === 0 && (
                  <p className="px-1 py-2 text-[11px] text-zinc-400">没有匹配的可见节点</p>
                )}
              </div>

              {hiddenCandidates.length > 0 && (
                <details className="rounded-lg border border-zinc-200 px-2 py-1.5 dark:border-zinc-700">
                  <summary className="cursor-pointer text-[11px] text-zinc-500">
                    今天不可见的节点（{hiddenCandidates.length}）—— 选中会给它打「临时可见」标记
                  </summary>
                  <div className="mt-1 space-y-1">
                    {hiddenCandidates.map((h) => (
                      <label
                        key={h.node.id}
                        className={cn(
                          "flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[11px]",
                          targetId === h.node.id
                            ? "bg-amber-50 dark:bg-amber-950/50"
                            : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60",
                        )}
                      >
                        <input
                          type="radio"
                          name="point-target"
                          className="accent-amber-600"
                          checked={targetId === h.node.id}
                          onChange={() => {
                            setTargetId(h.node.id);
                            setForceVisible(true);
                          }}
                        />
                        <Eye className="h-3 w-3 text-amber-500" />
                        <span className="truncate">{h.node.title}</span>
                      </label>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}

          {/* 临时可见 */}
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-2.5 py-2 dark:border-amber-900 dark:bg-amber-950/30">
            <input
              type="checkbox"
              className="mt-0.5 h-3.5 w-3.5 accent-amber-600"
              checked={forceVisible || targetIsHidden}
              disabled={targetIsHidden}
              onChange={(e) => setForceVisible(e.target.checked)}
            />
            <span className="min-w-0">
              <span className="block text-[12px] font-medium text-amber-800 dark:text-amber-200">
                目标节点今天不显示时，打「临时可见」标记
              </span>
              <span className="block text-[10px] leading-relaxed text-amber-700/80 dark:text-amber-300/80">
                只影响当天，不生成出现段；清除当日覆盖即可撤销（需求 4.4.4）
              </span>
            </span>
          </label>

          <div className="rounded-lg bg-zinc-50 px-2.5 py-2 text-[10px] leading-relaxed text-zinc-500 dark:bg-zinc-800/50 dark:text-zinc-400">
            <ArrowRight className="mr-1 inline h-3 w-3" />
            会建立 {selected.length} 条 <b>point（指向）</b> 类型的当天边：
            每个来源节点 → C。原节点保留并继续显示，C 的内容独立维护，不做内容合并。
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <button type="button" className="btn" onClick={close}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canConfirm}
            onClick={confirm}
          >
            {mode === "new" ? <Plus className="h-3.5 w-3.5" /> : <Target className="h-3.5 w-3.5" />}
            建立指向
          </button>
        </div>
      </div>
    </div>
  );
}
