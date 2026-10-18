/** 右侧时间树面板：出现段 / 子节点树 / 每日边（需求 4.3）。 */

import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Layers,
  Plus,
  Star,
  Trash2,
} from "lucide-react";

import { formatMd, formatTimestamp, today as todayStr } from "@/lib/date";
import {
  CONTINUATION_META,
  EDGE_TYPE_META,
  OCCURRENCE_SOURCE_META,
  STATUS_META,
} from "@/lib/labels";
import { cn } from "@/lib/util";
import { useAppStore } from "@/store/useAppStore";
import type { NodeSummary, OccurrenceSource, TimeTreeNode } from "@/types";

function StatCell({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-zinc-50 px-2 py-1.5 text-center dark:bg-zinc-800/60">
      <div className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{value}</div>
      <div className="text-[10px] text-zinc-400">{label}</div>
    </div>
  );
}

function TreeNode({
  node,
  onOpen,
}: {
  node: TimeTreeNode;
  onOpen: (id: string) => void;
}) {
  const [open, setOpen] = useState(node.depth <= 1);
  const hasChildren = node.children.length > 0;
  return (
    <div style={{ paddingLeft: (node.depth - 1) * 12 }}>
      <div className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
        <button
          type="button"
          className="shrink-0 text-zinc-400"
          onClick={() => setOpen((v) => !v)}
          disabled={!hasChildren}
        >
          {hasChildren ? (
            open ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )
          ) : (
            <span className="inline-block h-3 w-3" />
          )}
        </button>
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_META[node.node.status].dot)} />
        <button
          type="button"
          className="truncate text-left text-[12px] text-zinc-700 hover:underline dark:text-zinc-200"
          onClick={() => onOpen(node.node.id)}
        >
          {node.node.title}
        </button>
        {node.node.starred && <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />}
        <span className="ml-auto shrink-0 text-[10px] text-zinc-400">
          {STATUS_META[node.node.status].label}
        </span>
      </div>
      {open &&
        node.children.map((child) => (
          <TreeNode key={child.node.id} node={child} onOpen={onOpen} />
        ))}
    </div>
  );
}

export function TimeTreePanel() {
  const timeline = useAppStore((s) => s.timeline);
  const loading = useAppStore((s) => s.timelineLoading);
  const currentDate = useAppStore((s) => s.currentDate);

  const [newStart, setNewStart] = useState(currentDate);
  const [newEnd, setNewEnd] = useState("");

  if (loading && !timeline) {
    return <div className="p-4 text-center text-xs text-zinc-400">载入时间树…</div>;
  }
  if (!timeline) {
    return (
      <div className="p-4 text-center text-xs text-zinc-400">
        选中节点后这里会显示它的跨天时间树。
      </div>
    );
  }

  const { node, occurrences, childrenTree, dayEdges, overlays, stats, parent } = timeline;
  const setDate = (d: string) => void useAppStore.getState().setDate(d);
  const openDetail = (id: string) => void useAppStore.getState().openDetail(id, "timeline");

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
      {/* 头部 */}
      <div className="rounded-xl border border-zinc-200 p-2.5 dark:border-zinc-700">
        <div className="flex items-start gap-1.5">
          <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", STATUS_META[node.status].dot)} />
          <h3 className="flex-1 text-[13px] font-semibold leading-snug text-zinc-800 dark:text-zinc-100">
            {node.title}
          </h3>
          {node.starred && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          <span className={cn("badge", STATUS_META[node.status].bg, STATUS_META[node.status].text)}>
            {STATUS_META[node.status].label}
          </span>
          <span className="badge bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {CONTINUATION_META[node.continuation].label}
          </span>
          {parent && (
            <button
              type="button"
              className="badge bg-teal-100 text-teal-700 hover:underline dark:bg-teal-950 dark:text-teal-300"
              onClick={() => openDetail(parent.id)}
            >
              父：{parent.title}
            </button>
          )}
          <span className="badge bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            创建 {formatTimestamp(node.createdAt).slice(0, 10)}
          </span>
        </div>
      </div>

      {/* 统计 */}
      <div className="grid grid-cols-3 gap-1.5">
        <StatCell label="出现段" value={stats.occurrenceCount} />
        <StatCell label="覆盖天数" value={stats.spanDays} />
        <StatCell label="子节点" value={stats.childrenCount} />
        <StatCell label="有边天数" value={stats.edgeDays} />
        <StatCell label="被指向" value={stats.pointedByCount} />
        <StatCell label="覆盖记录" value={overlays.length} />
      </div>

      {/* 出现段 */}
      <section>
        <div className="section-title !px-0">
          <span className="flex items-center gap-1">
            <Layers className="h-3 w-3" />
            出现段
          </span>
          <span className="text-[10px] font-normal normal-case text-zinc-400">
            自动延续不物化每日出现段
          </span>
        </div>
        <div className="space-y-1">
          {occurrences.length === 0 && (
            <p className="px-1 text-[11px] text-zinc-400">还没有出现段</p>
          )}
          {occurrences.map((occ) => (
            <div
              key={occ.id}
              className="group flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2 py-1 text-[11px] dark:border-zinc-700"
            >
              <span className={cn("badge", OCCURRENCE_SOURCE_META[occ.source].badge)}>
                {OCCURRENCE_SOURCE_META[occ.source].label}
              </span>
              <span className="text-zinc-600 dark:text-zinc-300">
                {formatMd(occ.startDate)} → {occ.endDate ? formatMd(occ.endDate) : "持续"}
              </span>
              <div className="ml-auto flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                <button
                  type="button"
                  className="btn btn-ghost !px-1 !py-0.5"
                  title="跳转到出现段起始日"
                  onClick={() => setDate(occ.startDate)}
                >
                  <CalendarClock className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  className="btn btn-ghost !px-1 !py-0.5"
                  title="删除出现段（可用 Ctrl+Z 撤销）"
                  onClick={() => void useAppStore.getState().deleteOccurrence(occ.id, node.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* 新增出现段 */}
        <div className="mt-1.5 flex items-center gap-1">
          <input
            type="date"
            className="input !py-1 text-[11px] dark:[color-scheme:dark]"
            value={newStart}
            onChange={(e) => setNewStart(e.target.value)}
          />
          <input
            type="date"
            className="input !py-1 text-[11px] dark:[color-scheme:dark]"
            placeholder="结束（可空）"
            value={newEnd}
            onChange={(e) => setNewEnd(e.target.value)}
          />
          <button
            type="button"
            className="btn !px-1.5"
            title="手动新增出现段（留空结束日期表示持续）"
            onClick={() =>
              void useAppStore
                .getState()
                .addOccurrence(node.id, newStart, newEnd || null, "manual" as OccurrenceSource)
            }
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="mt-1 flex gap-1">
          <button
            type="button"
            className="btn btn-ghost !text-[10px]"
            onClick={() => void useAppStore.getState().reappearToday(node.id)}
          >
            今天重新出现
          </button>
          <button
            type="button"
            className="btn btn-ghost !text-[10px]"
            onClick={() => void useAppStore.getState().continueToNextDay(node.id)}
          >
            延续到明天
          </button>
          <button
            type="button"
            className="btn btn-ghost !text-[10px]"
            onClick={() => setDate(todayStr())}
          >
            回到今天
          </button>
        </div>
      </section>

      {/* 子节点树 */}
      <section>
        <div className="section-title !px-0">
          <span className="flex items-center gap-1">
            <GitBranch className="h-3 w-3" />
            子节点（跨天）
          </span>
        </div>
        {childrenTree.length === 0 ? (
          <p className="px-1 text-[11px] text-zinc-400">没有子节点</p>
        ) : (
          <div className="space-y-0.5">
            {childrenTree.map((child) => (
              <TreeNode key={child.node.id} node={child} onOpen={openDetail} />
            ))}
          </div>
        )}
      </section>

      {/* 每日边 */}
      <section>
        <div className="section-title !px-0">
          <span>每日边（它指向谁 / 被谁指向）</span>
          <span className="text-[10px] font-normal normal-case text-zinc-400">
            共 {dayEdges.length} 天
          </span>
        </div>
        {dayEdges.length === 0 ? (
          <p className="px-1 text-[11px] text-zinc-400">还没有任何当天边</p>
        ) : (
          <div className="space-y-1.5">
            {dayEdges.slice(0, 30).map((group) => (
              <div
                key={group.date}
                className="rounded-lg border border-zinc-200 px-2 py-1.5 dark:border-zinc-700"
              >
                <button
                  type="button"
                  className="mb-1 text-[11px] font-medium text-brand-600 hover:underline dark:text-brand-300"
                  onClick={() => setDate(group.date)}
                >
                  {group.date}
                  <span className="ml-1 text-zinc-400">
                    {currentDate === group.date ? "（当前）" : ""}
                  </span>
                </button>
                <div className="space-y-0.5">
                  {group.outgoing.map((item) => (
                    <div key={item.edge.id} className="flex items-center gap-1 text-[11px]">
                      <ArrowRight className="h-3 w-3 shrink-0 text-zinc-400" />
                      <button
                        type="button"
                        className="truncate text-zinc-600 hover:underline dark:text-zinc-300"
                        onClick={() => openDetail(item.peer.id)}
                      >
                        {item.peer.title}
                      </button>
                      {item.edge.type === "point" && (
                        <span className="badge bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300">
                          {EDGE_TYPE_META.point.label}
                        </span>
                      )}
                    </div>
                  ))}
                  {group.incoming.map((item) => (
                    <div key={item.edge.id} className="flex items-center gap-1 text-[11px]">
                      <ArrowLeft className="h-3 w-3 shrink-0 text-zinc-400" />
                      <button
                        type="button"
                        className="truncate text-zinc-600 hover:underline dark:text-zinc-300"
                        onClick={() => openDetail(item.peer.id)}
                      >
                        {item.peer.title}
                      </button>
                      <span className="text-[10px] text-zinc-400">指向本节点</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 覆盖摘要 */}
      {overlays.length > 0 && (
        <section>
          <div className="section-title !px-0">
            <span>局部覆盖记录</span>
          </div>
          <div className="space-y-0.5">
            {overlays.slice(0, 20).map((ov) => (
              <div
                key={ov.date}
                className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[11px] hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
              >
                <button
                  type="button"
                  className="text-brand-600 hover:underline dark:text-brand-300"
                  onClick={() => setDate(ov.date)}
                >
                  {ov.date}
                </button>
                {ov.hasTitle && <span className="text-zinc-400">改标题</span>}
                {ov.hasContent && <span className="text-zinc-400">改正文</span>}
                {ov.visible === false && <span className="text-rose-500">当天隐藏</span>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** 供 RightPanel 复用的节点摘要渲染（子节点列表）。 */
export function SummaryChip({ summary }: { summary: NodeSummary }) {
  return (
    <span className={cn("badge", STATUS_META[summary.status].bg, STATUS_META[summary.status].text)}>
      {summary.title}
    </span>
  );
}
