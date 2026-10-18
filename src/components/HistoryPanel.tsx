/** 历史面板（阶段 2）：操作记录 + 每日快照（需求 4.7 / 6.5 / 6.6）。 */

import { useEffect } from "react";
import {
  Camera,
  Clock3,
  Database,
  History,
  RotateCcw,
  Trash2,
} from "lucide-react";

import { formatTimestamp } from "@/lib/date";
import { cn } from "@/lib/util";
import { useAppStore } from "@/store/useAppStore";
import type { OperationRecord, SnapshotSummary } from "@/types";

const ENTITY_LABEL: Record<string, string> = {
  node: "节点",
  day_edge: "当天边",
  day_overlay: "当日覆盖",
  occurrence: "出现段",
  snapshot: "快照",
};

const ACTION_LABEL: Record<string, string> = {
  create: "新建",
  update: "修改",
  soft_delete: "删除",
  delete: "删除",
  copy_to_next_day: "复制到明天",
  force_visible_on: "临时可见",
  force_visible_off: "取消临时可见",
  restore: "恢复",
};

function shorten(json: string | null, max = 90): string {
  if (!json) return "";
  const compact = json.replace(/\s+/g, " ");
  return compact.length > max ? `${compact.slice(0, max)}…` : compact;
}

function OperationRow({ op }: { op: OperationRecord }) {
  const entity = ENTITY_LABEL[op.entityType] ?? op.entityType;
  const action = ACTION_LABEL[op.action] ?? op.action;
  const danger = op.action.includes("delete");
  return (
    <div className="rounded-lg border border-zinc-200 px-2 py-1.5 text-[11px] dark:border-zinc-700">
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "badge",
            danger
              ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
              : "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300",
          )}
        >
          {action}
        </span>
        <span className="text-zinc-500 dark:text-zinc-400">{entity}</span>
        <span className="ml-auto shrink-0 text-[10px] text-zinc-400">
          {formatTimestamp(op.createdAt)}
        </span>
      </div>
      <div className="mt-0.5 truncate font-mono text-[10px] text-zinc-400" title={op.entityId}>
        {op.entityId}
      </div>
      {op.afterJson && (
        <div
          className="mt-0.5 line-clamp-2 break-all font-mono text-[10px] text-zinc-400/80"
          title={op.afterJson}
        >
          {shorten(op.afterJson)}
        </div>
      )}
    </div>
  );
}

function SnapshotRow({ snap }: { snap: SnapshotSummary }) {
  const currentDate = useAppStore((s) => s.currentDate);
  const isCurrent = snap.date === currentDate;
  return (
    <div
      className={cn(
        "rounded-lg border px-2 py-1.5 text-[11px]",
        isCurrent
          ? "border-brand-200 bg-brand-50/60 dark:border-brand-800 dark:bg-brand-950/40"
          : "border-zinc-200 dark:border-zinc-700",
      )}
    >
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="font-medium text-brand-700 hover:underline dark:text-brand-300"
          onClick={() => void useAppStore.getState().setDate(snap.date)}
        >
          {snap.date}
        </button>
        <span className="text-[10px] text-zinc-400">
          {formatTimestamp(snap.createdAt)}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            className="btn btn-ghost !px-1 !py-0.5"
            title="从这个快照恢复当天数据（覆盖当日边 / 覆盖 / 布局）"
            onClick={() => void useAppStore.getState().restoreSnapshot(snap.date)}
          >
            <RotateCcw className="h-3 w-3" />
          </button>
          <button
            type="button"
            className="btn btn-ghost !px-1 !py-0.5"
            title="删除快照"
            onClick={() => void useAppStore.getState().deleteSnapshot(snap.date)}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
      <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-zinc-400">
        <span>节点 {snap.nodeCount}</span>
        <span>出现段 {snap.occurrenceCount}</span>
        <span>覆盖 {snap.overlayCount}</span>
        <span>边 {snap.edgeCount}</span>
        <span>布局 {snap.layoutCount}</span>
        <span>{(snap.sizeBytes / 1024).toFixed(1)} KB</span>
      </div>
    </div>
  );
}

export function HistoryPanel() {
  const operations = useAppStore((s) => s.operations);
  const snapshots = useAppStore((s) => s.snapshots);
  const currentDate = useAppStore((s) => s.currentDate);

  useEffect(() => {
    void useAppStore.getState().loadHistory();
  }, []);

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
      {/* 当前日期快照 */}
      <section>
        <div className="section-title !px-0">
          <span className="flex items-center gap-1">
            <Camera className="h-3 w-3" />
            每日快照 · {currentDate}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void useAppStore.getState().createSnapshot()}
          >
            <Camera className="h-3.5 w-3.5" />
            立即生成快照
          </button>
          <span className="text-[10px] leading-snug text-zinc-400">
            每天首次进入会自动生成；
            <br />
            恢复只覆盖当天的边 / 覆盖 / 布局
          </span>
        </div>
      </section>

      {/* 快照列表 */}
      <section>
        <div className="section-title !px-0">
          <span className="flex items-center gap-1">
            <Database className="h-3 w-3" />
            快照
          </span>
          <span className="text-[10px] font-normal normal-case text-zinc-400">
            共 {snapshots.length} 份
          </span>
        </div>
        {snapshots.length === 0 ? (
          <p className="px-1 text-[11px] text-zinc-400">还没有快照</p>
        ) : (
          <div className="space-y-1">
            {snapshots.slice(0, 40).map((snap) => (
              <SnapshotRow key={snap.date} snap={snap} />
            ))}
          </div>
        )}
      </section>

      {/* 操作记录 */}
      <section>
        <div className="section-title !px-0">
          <span className="flex items-center gap-1">
            <History className="h-3 w-3" />
            操作记录
          </span>
          <span className="text-[10px] font-normal normal-case text-zinc-400">
            最近 {operations.length} 条
          </span>
        </div>
        {operations.length === 0 ? (
          <p className="px-1 text-[11px] text-zinc-400">还没有操作记录</p>
        ) : (
          <div className="space-y-1">
            {operations.slice(0, 200).map((op) => (
              <OperationRow key={op.id} op={op} />
            ))}
          </div>
        )}
      </section>

      <p className="flex items-start gap-1 px-1 text-[10px] leading-relaxed text-zinc-400">
        <Clock3 className="mt-0.5 h-3 w-3 shrink-0" />
        操作记录只存元数据与前后快照，正文全文保存在 content_revisions（每保存一次一个版本）。
      </p>
    </div>
  );
}
