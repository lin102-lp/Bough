/** 枚举 → 中文标签与配色（内部枚举一律英文，UI 显示中文，需求 5.4）。 */

import type {
  Continuation,
  EdgeType,
  FollowMode,
  NodeStatus,
  OccurrenceSource,
  VisibilityReason,
} from "@/types";

interface Meta {
  label: string;
  /** Tailwind 类：文字 / 背景 / 边框 */
  text: string;
  bg: string;
  border: string;
  dot: string;
}

export const STATUS_META: Record<NodeStatus, Meta> = {
  todo: {
    label: "待办",
    text: "text-zinc-600 dark:text-zinc-300",
    bg: "bg-zinc-100 dark:bg-zinc-800",
    border: "border-zinc-300 dark:border-zinc-600",
    dot: "bg-zinc-400",
  },
  doing: {
    label: "进行中",
    text: "text-blue-700 dark:text-blue-300",
    bg: "bg-blue-50 dark:bg-blue-950",
    border: "border-blue-300 dark:border-blue-700",
    dot: "bg-blue-500",
  },
  done: {
    label: "已完成",
    text: "text-emerald-700 dark:text-emerald-300",
    bg: "bg-emerald-50 dark:bg-emerald-950",
    border: "border-emerald-300 dark:border-emerald-700",
    dot: "bg-emerald-500",
  },
  cancelled: {
    label: "已取消",
    text: "text-zinc-500 dark:text-zinc-400",
    bg: "bg-zinc-100 dark:bg-zinc-900",
    border: "border-zinc-300 dark:border-zinc-700",
    dot: "bg-zinc-400",
  },
};

export const STATUS_ORDER: NodeStatus[] = ["todo", "doing", "done", "cancelled"];

export const CONTINUATION_META: Record<Continuation, { label: string; hint: string }> = {
  auto: { label: "自动延续", hint: "未完成时自动出现在后续日期（动态可见，不物化出现段）" },
  manual: { label: "手动延续", hint: "需要手动延续到次日" },
  none: { label: "不延续", hint: "只出现在创建当天" },
  reappear: { label: "休眠后重现", hint: "停止后需要手动重新出现" },
};

export const OCCURRENCE_SOURCE_META: Record<OccurrenceSource, { label: string; badge: string }> = {
  auto: { label: "自动延续", badge: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" },
  manual: { label: "手动延续", badge: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
  reappear: { label: "重新出现", badge: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950 dark:text-fuchsia-300" },
  follow: { label: "跟随父节点", badge: "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300" },
};

export const EDGE_TYPE_META: Record<EdgeType, { label: string; color: string }> = {
  single: { label: "普通边", color: "#71717a" },
  point: { label: "指向", color: "#8b5cf6" },
};

export const FOLLOW_MODE_META: Record<FollowMode, { label: string }> = {
  default: { label: "默认（跟随父节点）" },
  follow: { label: "跟随" },
  never: { label: "不跟随" },
  delayed: { label: "延迟出现" },
  independent: { label: "独立出现" },
};

/** 可见性判定原因 → 中文解释（用于隐藏节点列表与 tooltip） */
export const VISIBILITY_META: Record<VisibilityReason, { label: string; hint: string }> = {
  soft_deleted: { label: "已删除", hint: "节点在回收站中，恢复后重新参与判定" },
  cancelled: { label: "已取消", hint: "已取消的节点默认隐藏（可用筛选器显示）" },
  overlay_hidden: { label: "当日隐藏", hint: "该节点在这一天被手动设置为隐藏" },
  overlay_force_visible: {
    label: "临时可见",
    hint: "指向时为目标节点打的「仅当天可见」标记，不生成出现段",
  },
  completed_auto_stop: { label: "已完成", hint: "完成之后自动延续停止" },
  parent_follow: { label: "跟随父节点", hint: "父节点当天可见，子节点一同出现" },
  parent_follow_hidden: { label: "父节点不可见", hint: "父节点当天不可见，子节点跟随隐藏" },
  occurrence_cover: { label: "出现段", hint: "当天落在某个出现段内" },
  auto_continuation: { label: "自动延续", hint: "开放出现段 + 未完成 → 动态可见" },
  default_hidden: { label: "默认隐藏", hint: "没有出现段覆盖，也没有开启自动延续" },
};

export function continuationLabel(value: Continuation): string {
  return CONTINUATION_META[value]?.label ?? value;
}

export function statusLabel(value: NodeStatus): string {
  return STATUS_META[value]?.label ?? value;
}

export function visibilityLabel(reason: VisibilityReason): string {
  return VISIBILITY_META[reason]?.label ?? reason;
}
