/** 日期图节点卡片（React Flow 自定义节点）。 */

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  Eye,
  EyeOff,
  Info,
  Link2,
  Play,
  Star,
} from "lucide-react";

import { OCCURRENCE_SOURCE_META, STATUS_META, VISIBILITY_META, statusLabel } from "@/lib/labels";
import { cn } from "@/lib/util";
import type { NodeStatus } from "@/types";

import type { TTNode } from "./types";

const STATUS_CYCLE: Record<NodeStatus, NodeStatus> = {
  todo: "doing",
  doing: "done",
  done: "todo",
  cancelled: "todo",
};

export const NodeCard = memo(function NodeCard({ data, selected }: NodeProps<TTNode>) {
  const {
    dayNode,
    preview,
    hiddenOnly,
    connectSource,
    connectMode,
    onToggleStatus,
    onToggleStar,
    onContinue,
    onOpenDetail,
    onSetVisible,
    onConnectPick,
  } = data;

  const { node, displayTitle, overlay, hasOverlayContent, visibility, occurrence, dayIndex } =
    dayNode;
  const meta = STATUS_META[node.status];

  // ---------- 来源徽标（需求 4.2.3：显示节点来源） ----------
  const sourceBadge = (() => {
    if (hiddenOnly) {
      return {
        text: `隐藏 · ${VISIBILITY_META[visibility.reason]?.label ?? visibility.reason}`,
        className: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
      };
    }
    if (!occurrence) return null;
    if (visibility.reason === "auto_continuation") {
      return {
        text: dayIndex && dayIndex > 1 ? `自动延续 · 第 ${dayIndex} 天` : "自动延续",
        className: OCCURRENCE_SOURCE_META.auto.badge,
      };
    }
    const meta2 = OCCURRENCE_SOURCE_META[occurrence.source];
    return {
      text:
        occurrence.source === "manual" && dayIndex && dayIndex > 1
          ? `${meta2.label} · 第 ${dayIndex} 天`
          : meta2.label,
      className: meta2.badge,
    };
  })();

  const hasOverlay = Boolean(overlay && (overlay.title || hasOverlayContent));
  const overlayHidden = overlay?.visible === false;

  return (
    <div
      className={cn(
        "group w-[248px] rounded-xl border bg-white shadow-node transition dark:bg-zinc-900",
        "border-zinc-200 dark:border-zinc-700",
        selected && "ring-2 ring-brand-500 ring-offset-1 dark:ring-offset-zinc-950",
        connectSource && "ring-2 ring-amber-400",
        hiddenOnly && "border-dashed opacity-60",
        node.status === "cancelled" && "opacity-70",
        connectMode && "cursor-crosshair",
      )}
      onDoubleClick={() => onOpenDetail(node.id)}
    >
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />

      {/* 顶部状态条 */}
      <div
        className={cn(
          "h-1 w-full rounded-t-xl",
          node.status === "doing" && "bg-blue-400",
          node.status === "done" && "bg-emerald-400",
          node.status === "todo" && "bg-zinc-300 dark:bg-zinc-600",
          node.status === "cancelled" && "bg-zinc-300 dark:bg-zinc-700",
        )}
      />

      <div className="space-y-1.5 px-3 py-2">
        {/* 标题行 */}
        <div className="flex items-start gap-1.5">
          <button
            type="button"
            title={`切换状态（当前：${statusLabel(node.status)}）`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleStatus(node.id, STATUS_CYCLE[node.status]);
            }}
            className="nodrag mt-0.5 shrink-0 text-zinc-400 transition hover:text-brand-500"
          >
            {node.status === "done" ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            ) : (
              <Circle className="h-4 w-4" />
            )}
          </button>

          <div
            className={cn(
              "min-w-0 flex-1 text-[13px] font-medium leading-snug",
              node.status === "done" && "text-zinc-500 line-through dark:text-zinc-400",
              node.status === "cancelled" && "text-zinc-400 line-through",
            )}
            title={displayTitle}
          >
            {displayTitle}
          </div>

          <button
            type="button"
            title={node.starred ? "取消星标" : "标记为重要"}
            onClick={(e) => {
              e.stopPropagation();
              onToggleStar(node.id);
            }}
            className="nodrag shrink-0"
          >
            <Star
              className={cn(
                "h-3.5 w-3.5 transition",
                node.starred
                  ? "fill-amber-400 text-amber-400"
                  : "text-zinc-300 hover:text-amber-400 dark:text-zinc-600",
              )}
            />
          </button>
        </div>

        {/* 徽标行 */}
        <div className="flex flex-wrap items-center gap-1">
          <span className={cn("badge", meta.bg, meta.text)}>{meta.label}</span>
          {sourceBadge && <span className={cn("badge", sourceBadge.className)}>{sourceBadge.text}</span>}
          {hasOverlay && (
            <span className="badge bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300">
              当日覆盖
            </span>
          )}
          {overlayHidden && (
            <span className="badge bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300">
              当日隐藏
            </span>
          )}
          {node.continuation === "none" && !hiddenOnly && (
            <span className="badge bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              不延续
            </span>
          )}
          {hiddenOnly && (
            <span
              className="badge bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
              title={visibility.detail}
            >
              {VISIBILITY_META[visibility.reason]?.hint ?? visibility.detail}
            </span>
          )}
        </div>

        {/* 正文预览 */}
        {preview ? (
          <p className="line-clamp-2 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            {preview}
          </p>
        ) : (
          <p className="text-[11px] italic text-zinc-300 dark:text-zinc-600">（暂无正文）</p>
        )}

        {/* 悬停操作条 */}
        <div className="flex items-center gap-1 pt-0.5 opacity-0 transition group-hover:opacity-100">
          <button
            type="button"
            className="nodrag btn btn-ghost !px-1.5 !py-0.5 !text-[10px]"
            title="手动延续到明天"
            onClick={(e) => {
              e.stopPropagation();
              onContinue(node.id);
            }}
          >
            <ArrowRight className="h-3 w-3" />
            延续
          </button>
          {connectMode ? (
            <button
              type="button"
              className="nodrag btn btn-ghost !px-1.5 !py-0.5 !text-[10px]"
              title="把这条边连到另一个节点"
              onClick={(e) => {
                e.stopPropagation();
                onConnectPick(node.id);
              }}
            >
              <Link2 className="h-3 w-3" />
              连线
            </button>
          ) : (
            <button
              type="button"
              className="nodrag btn btn-ghost !px-1.5 !py-0.5 !text-[10px]"
              title="用鼠标从一个节点右侧圆点拖到另一个节点"
              onClick={(e) => {
                e.stopPropagation();
                onOpenDetail(node.id);
              }}
            >
              <Info className="h-3 w-3" />
              详情
            </button>
          )}
          {node.status !== "doing" && node.status !== "done" && (
            <button
              type="button"
              className="nodrag btn btn-ghost !px-1.5 !py-0.5 !text-[10px]"
              title="标记为进行中"
              onClick={(e) => {
                e.stopPropagation();
                onToggleStatus(node.id, "doing");
              }}
            >
              <Play className="h-3 w-3" />
              开始
            </button>
          )}
          <button
            type="button"
            className="nodrag btn btn-ghost !px-1.5 !py-0.5 !text-[10px]"
            title={overlayHidden ? "取消当日隐藏" : "仅在这一天隐藏"}
            onClick={(e) => {
              e.stopPropagation();
              onSetVisible(node.id, overlayHidden);
            }}
          >
            {overlayHidden ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            {overlayHidden ? "显示" : "隐藏"}
          </button>
        </div>
      </div>
    </div>
  );
});
