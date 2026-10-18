/** 左侧面板：节点列表 / 筛选器 / 隐藏节点（需求 7.1）。 */

import { useMemo } from "react";
import {
  CalendarClock,
  EyeOff,
  Layers,
  Link2,
  Star,
  Target,
} from "lucide-react";

import { formatMd, formatTimestamp } from "@/lib/date";
import { STATUS_META, VISIBILITY_META, statusLabel } from "@/lib/labels";
import { cn } from "@/lib/util";
import { useAppStore } from "@/store/useAppStore";
import { STATUS_ORDER } from "@/lib/labels";
import type { NodeListItem, NodeStatus } from "@/types";

function ListRow({
  item,
  onSelect,
  onJump,
  hint,
}: {
  item: NodeListItem;
  onSelect: () => void;
  onJump: () => void;
  hint?: string;
}) {
  const meta = STATUS_META[item.node.status];
  return (
    <div
      className={cn(
        "group cursor-pointer rounded-lg border border-transparent px-2 py-1.5 transition",
        "hover:border-zinc-200 hover:bg-zinc-50 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/60",
      )}
      onClick={onSelect}
    >
      <div className="flex items-start gap-1.5">
        <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", meta.dot)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <span className="truncate text-[13px] font-medium text-zinc-800 dark:text-zinc-100">
              {item.node.title}
            </span>
            {item.node.starred && <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-zinc-400">
            <span className={meta.text}>{meta.label}</span>
            {item.firstDate && (
              <span>
                {formatMd(item.firstDate)}
                {item.lastDate && item.lastDate !== item.firstDate ? ` → ${formatMd(item.lastDate)}` : ""}
              </span>
            )}
            {item.hasOpenSpan && <span className="text-indigo-500">延续中</span>}
            {item.occurrenceCount > 0 && (
              <span className="inline-flex items-center gap-0.5">
                <Layers className="h-2.5 w-2.5" />
                {item.occurrenceCount}
              </span>
            )}
            {item.edgeCount > 0 && (
              <span className="inline-flex items-center gap-0.5">
                <Link2 className="h-2.5 w-2.5" />
                {item.edgeCount}
              </span>
            )}
            {hint && <span className="text-zinc-400">{hint}</span>}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-ghost !px-1 !py-0.5 opacity-0 transition group-hover:opacity-100"
          title="跳转到该节点的日期视图"
          onClick={(e) => {
            e.stopPropagation();
            onJump();
          }}
        >
          <CalendarClock className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

export function LeftPanel() {
  const dayView = useAppStore((s) => s.dayView);
  const nodeList = useAppStore((s) => s.nodeList);
  const listScope = useAppStore((s) => s.listScope);
  const starredOnly = useAppStore((s) => s.starredOnly);
  const statusFilter = useAppStore((s) => s.statusFilter);
  const currentDate = useAppStore((s) => s.currentDate);
  const detailNodeId = useAppStore((s) => s.detailNodeId);

  const hiddenItems = useMemo(() => {
    if (!dayView) return [];
    return dayView.hidden.map((h) => ({
      node: h.node,
      occurrenceCount: 0,
      firstDate: null,
      lastDate: null,
      hasOpenSpan: false,
      edgeCount: 0,
      reason: h.visibility.reason,
      detail: h.visibility.detail,
    }));
  }, [dayView]);

  const openDetail = (id: string) => void useAppStore.getState().openDetail(id, "detail");

  return (
    <aside className="flex w-[268px] shrink-0 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      {/* 范围切换 */}
      <div className="flex gap-1 border-b border-zinc-100 p-2 dark:border-zinc-800">
        {(
          [
            ["day", "当天"],
            ["all", "全部"],
            ["hidden", `隐藏${hiddenItems.length ? ` ${hiddenItems.length}` : ""}`],
          ] as const
        ).map(([scope, label]) => (
          <button
            key={scope}
            type="button"
            className={cn(
              "flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition",
              listScope === scope
                ? "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300"
                : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800",
            )}
            onClick={() => {
              useAppStore.getState().setListScope(scope);
              if (scope === "all") void useAppStore.getState().refreshNodeList();
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 筛选器 */}
      <div className="flex flex-wrap items-center gap-1 border-b border-zinc-100 px-2 py-1.5 dark:border-zinc-800">
        <button
          type="button"
          className={cn("chip", starredOnly ? "border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300" : "border-zinc-200 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400")}
          onClick={() => {
            const next = !starredOnly;
            useAppStore.getState().setStarredOnly(next);
            void useAppStore.getState().refreshNodeList({ starredOnly: next || null });
          }}
        >
          <Star className="h-3 w-3" />
          星标
        </button>
        {STATUS_ORDER.map((status: NodeStatus) => {
          const active = statusFilter.includes(status);
          const meta = STATUS_META[status];
          return (
            <button
              key={status}
              type="button"
              className={cn(
                "chip",
                active
                  ? `${meta.border} ${meta.bg} ${meta.text}`
                  : "border-zinc-200 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400",
              )}
              onClick={() => {
                useAppStore.getState().toggleStatusFilter(status);
                const next = useAppStore.getState().statusFilter;
                void useAppStore.getState().refreshNodeList({ statuses: next.length ? next : null });
              }}
            >
              {statusLabel(status)}
            </button>
          );
        })}
      </div>

      {/* 列表 */}
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
        {listScope === "hidden" ? (
          hiddenItems.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-zinc-400">
              今天没有被隐藏的节点
            </p>
          ) : (
            hiddenItems.map((item) => (
              <div
                key={item.node.id}
                className="cursor-pointer rounded-lg px-2 py-1.5 transition hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                onClick={() => openDetail(item.node.id)}
              >
                <div className="flex items-center gap-1.5">
                  <EyeOff className="h-3 w-3 shrink-0 text-zinc-400" />
                  <span className="truncate text-[13px] text-zinc-600 dark:text-zinc-300">
                    {item.node.title}
                  </span>
                </div>
                <div className="mt-0.5 pl-4 text-[10px] text-zinc-400">
                  {VISIBILITY_META[item.reason]?.label ?? item.reason}
                  <span className="ml-1 text-zinc-300 dark:text-zinc-600">{item.detail}</span>
                </div>
              </div>
            ))
          )
        ) : listScope === "day" ? (
          (dayView?.nodes.length ?? 0) === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-zinc-400">今天还没有可见节点</p>
          ) : (
            dayView!.nodes.map((dn) => (
              <div
                key={dn.node.id}
                className={cn(
                  "cursor-pointer rounded-lg px-2 py-1.5 transition",
                  detailNodeId === dn.node.id
                    ? "bg-brand-50 dark:bg-brand-950/60"
                    : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60",
                )}
                onClick={() => openDetail(dn.node.id)}
              >
                <div className="flex items-center gap-1.5">
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_META[dn.node.status].dot)} />
                  <span className="truncate text-[13px] font-medium text-zinc-800 dark:text-zinc-100">
                    {dn.displayTitle}
                  </span>
                  {dn.node.starred && (
                    <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />
                  )}
                  {dn.visibility.reason === "auto_continuation" && (
                    <span className="badge bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                      延续
                    </span>
                  )}
                  {dn.occurrence?.source === "reappear" && (
                    <span className="badge bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950 dark:text-fuchsia-300">
                      重现
                    </span>
                  )}
                  {dn.overlay && (
                    <span className="badge bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300">
                      覆盖
                    </span>
                  )}
                </div>
                <div className="mt-0.5 pl-3.5 text-[10px] text-zinc-400">
                  {dn.continuedFrom && dn.dayIndex && dn.dayIndex > 1
                    ? `自 ${formatMd(dn.continuedFrom)} 起第 ${dn.dayIndex} 天`
                    : `创建于 ${formatTimestamp(dn.node.createdAt).slice(0, 10)}`}
                </div>
              </div>
            ))
          )
        ) : nodeList.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-zinc-400">没有匹配的节点</p>
        ) : (
          nodeList.map((item) => (
            <ListRow
              key={item.node.id}
              item={item}
              onSelect={() => openDetail(item.node.id)}
              onJump={() =>
                void useAppStore
                  .getState()
                  .setDate(item.lastDate ?? item.firstDate ?? currentDate)
              }
            />
          ))
        )}
      </div>

      <div className="border-t border-zinc-100 px-3 py-2 text-[10px] leading-relaxed text-zinc-400 dark:border-zinc-800">
        <div className="flex items-center gap-1">
          <Target className="h-3 w-3" />
          指向 = 多个节点当天共同指向一个独立节点 C
        </div>
      </div>
    </aside>
  );
}
