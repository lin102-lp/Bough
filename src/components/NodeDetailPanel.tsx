/** 右侧详情面板：节点本体编辑 / 当日局部编辑 / 可见性解释（需求 4.1.3、4.2.5）。 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Eye,
  EyeOff,
  Info,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";

import * as api from "@/api/commands";
import { formatMd, formatTimestamp } from "@/lib/date";import {
  CONTINUATION_META,
  FOLLOW_MODE_META,
  OCCURRENCE_SOURCE_META,
  STATUS_META,
  STATUS_ORDER,
  VISIBILITY_META,
} from "@/lib/labels";
import { cn } from "@/lib/util";
import { useAppStore } from "@/store/useAppStore";
import type { Continuation, EditScope, FollowMode, NodeStatus } from "@/types";

export function NodeDetailPanel() {
  const detailNodeId = useAppStore((s) => s.detailNodeId);
  const dayView = useAppStore((s) => s.dayView);
  const currentDate = useAppStore((s) => s.currentDate);
  const nodeList = useAppStore((s) => s.nodeList);
  const followOverrides = useAppStore((s) => s.followOverrides);

  const dayNode = useMemo(
    () => dayView?.nodes.find((n) => n.node.id === detailNodeId) ?? null,
    [dayView, detailNodeId],
  );
  const hiddenNode = useMemo(
    () => dayView?.hidden.find((n) => n.node.id === detailNodeId) ?? null,
    [dayView, detailNodeId],
  );
  const node = dayNode?.node ?? hiddenNode?.node ?? null;
  const visibility = dayNode?.visibility ?? hiddenNode?.visibility ?? null;
  const overlay = dayNode?.overlay ?? null;
  const followOverride = node
    ? (followOverrides.find(
        (f) => f.nodeId === node.id && f.parentId === node.parentId,
      ) ?? null)
    : null;

  const [scope, setScope] = useState<EditScope>(() =>
    useAppStore.getState().settings["default_edit_mode"] === "global" ? "global" : "overlay",
  );
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [globalContentLength, setGlobalContentLength] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  /** 只有「换了节点 / 换了日期 / 换了编辑范围」才重置表单，避免刷新时冲掉正在输入的内容 */
  const formKeyRef = useRef<string>("");

  const formKey = `${detailNodeId ?? ""}|${currentDate}|${scope}`;

  // 载入正文：当日局部编辑读覆盖内容；编辑本体读 Markdown 文件
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!detailNodeId) return;
      setLoaded(false);
      try {
        const globalText = await api.getNodeContent(detailNodeId);
        if (cancelled) return;
        setGlobalContentLength(globalText.length);
        if (scope === "overlay") {
          const fresh = useAppStore.getState().dayView;
          const ov = fresh?.nodes.find((n) => n.node.id === detailNodeId)?.overlay ?? null;
          setContent(ov?.content ?? "");
        } else {
          setContent(globalText);
        }
      } catch {
        if (!cancelled) setContent("");
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [detailNodeId, currentDate, scope]);

  // 标题同步（同上，只在 formKey 变化时重置）
  useEffect(() => {
    if (!node) return;
    if (formKeyRef.current === formKey) return;
    formKeyRef.current = formKey;
    setTitle(scope === "overlay" ? (overlay?.title ?? "") : node.title);
  }, [node, overlay?.title, scope, formKey]);

  if (!node || !detailNodeId) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-xs text-zinc-400">
        在图中或左侧列表里选中一个节点，这里会显示它的详情、出现段与可见性判定过程。
      </div>
    );
  }

  const meta = STATUS_META[node.status];
  const isHidden = visibility ? !visibility.visible : false;

  const handleSave = async () => {
    setSaving(true);
    const store = useAppStore.getState();
    try {
      if (scope === "overlay") {
        await store.saveOverlay({
          nodeId: node.id,
          title: title.trim() === "" ? null : title.trim(),
          content: content === "" ? null : content,
          visible: overlay?.visible ?? null,
          sortOrder: overlay?.sortOrder ?? null,
        });
      } else {
        await store.updateNodeMeta(node.id, { title: title.trim() || node.title });
        await store.saveNodeContent(node.id, content);
      }
    } finally {
      setSaving(false);
    }
  };

  const parentCandidates = nodeList
    .map((i) => i.node)
    .filter((n) => n.id !== node.id && n.deletedAt === null)
    .slice(0, 200);

  return (
    <div className="flex h-full flex-col">
      {/* 编辑范围切换 */}
      <div className="flex items-center gap-1 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
        {(
          [
            ["overlay", "当日局部编辑"],
            ["global", "编辑节点本体"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={cn(
              "flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition",
              scope === value
                ? value === "overlay"
                  ? "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300"
                  : "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300"
                : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800",
            )}
            onClick={() => setScope(value as EditScope)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {scope === "overlay" && (
          <div className="rounded-lg border border-violet-200 bg-violet-50/60 px-2.5 py-1.5 text-[11px] text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300">
            只影响 <b>{currentDate}</b> 这一天的显示，节点本体与其他日期不变。
            {globalContentLength > 0 && (
              <button
                type="button"
                className="ml-1 underline decoration-dotted"
                onClick={() => void loadGlobalIntoContent()}
              >
                以本体正文为草稿（{globalContentLength} 字）
              </button>
            )}
          </div>
        )}

        {/* 标题 */}
        <div>
          <label className="label">标题</label>
          <input
            className="input"
            value={title}
            placeholder={scope === "overlay" ? `留空则使用本体标题：${node.title}` : "节点标题"}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        {/* 本体属性 */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">状态（本体）</label>
            <select
              className="input"
              value={node.status}
              onChange={(e) =>
                void useAppStore.getState().setNodeStatus(node.id, e.target.value as NodeStatus)
              }
            >
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STATUS_META[s].label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">延续策略（本体）</label>
            <select
              className="input"
              value={node.continuation}
              onChange={(e) =>
                void useAppStore
                  .getState()
                  .updateNodeMeta(node.id, { continuation: e.target.value as Continuation })
              }
            >
              {(Object.keys(CONTINUATION_META) as Continuation[]).map((c) => (
                <option key={c} value={c}>
                  {CONTINUATION_META[c].label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className={cn("btn", node.starred && "!border-amber-300 !text-amber-600")}
            onClick={() => void useAppStore.getState().toggleStar(node.id)}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {node.starred ? "已标记重要" : "标记为重要"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() =>
              void useAppStore.getState().saveOverlay({
                nodeId: node.id,
                title: overlay?.title ?? null,
                content: overlay?.content ?? null,
                visible: overlay?.visible === false ? null : false,
                sortOrder: overlay?.sortOrder ?? null,
              })
            }
            title="仅在这一天隐藏该节点（当日覆盖 visible=false）"
          >
            {overlay?.visible === false ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            {overlay?.visible === false ? "取消当天隐藏" : "仅当天隐藏"}
          </button>
          <button
            type="button"
            className={cn(
              "btn",
              overlay?.forceVisible && "!border-amber-300 !text-amber-600 dark:!text-amber-300",
            )}
            title="仅当天强制显示，不生成出现段（指向目标节点时使用）"
            onClick={() =>
              void useAppStore.getState().setDayForceVisible(node.id, !overlay?.forceVisible)
            }
          >
            <Zap className="h-3.5 w-3.5" />
            {overlay?.forceVisible ? "取消临时可见" : "临时可见"}
          </button>
          {overlay && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void useAppStore.getState().clearOverlay(node.id)}
            >
              清除当日覆盖
            </button>
          )}
        </div>

        {/* 父节点 */}
        <div>
          <label className="label">父节点（跨天树）</label>
          <select
            className="input"
            value={node.parentId ?? ""}
            onChange={(e) =>
              void useAppStore
                .getState()
                .updateNodeMeta(node.id, { parentId: e.target.value || null })
            }
          >
            <option value="">（无父节点）</option>
            {parentCandidates.map((n) => (
              <option key={n.id} value={n.id}>
                {n.title}
              </option>
            ))}
          </select>
        </div>

        {node.parentId && (
          <div className="space-y-1 rounded-lg border border-teal-200 bg-teal-50/50 px-2.5 py-2 dark:border-teal-900 dark:bg-teal-950/30">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-teal-800 dark:text-teal-200">
                子节点跟随（阶段 2）
              </span>
              {followOverride && (
                <button
                  type="button"
                  className="text-[10px] text-teal-700 underline decoration-dotted dark:text-teal-300"
                  onClick={() =>
                    void useAppStore
                      .getState()
                      .deleteFollowOverride(node.id, node.parentId as string)
                  }
                >
                  清除覆盖
                </button>
              )}
            </div>
            <select
              className="input !py-1 text-[11px]"
              value={followOverride?.mode ?? "default"}
              onChange={(e) =>
                void useAppStore.getState().saveFollowOverride({
                  nodeId: node.id,
                  parentId: node.parentId as string,
                  mode: e.target.value as FollowMode,
                  startDate: followOverride?.startDate ?? null,
                  endDate: followOverride?.endDate ?? null,
                })
              }
            >
              {(Object.keys(FOLLOW_MODE_META) as FollowMode[]).map((m) => (
                <option key={m} value={m}>
                  {FOLLOW_MODE_META[m].label}
                </option>
              ))}
            </select>
            <p className="text-[10px] leading-relaxed text-teal-700/80 dark:text-teal-300/80">
              父节点当天可见时，子节点是否跟随出现。需要在「设置 → 可见性状态机」里打开
              「子节点跟随父节点」开关才会生效。
            </p>
          </div>
        )}

        {/* 正文 */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="label !mb-0">
              正文（Markdown）{scope === "overlay" ? " · 当日覆盖" : " · 节点本体"}
            </span>
            {scope === "overlay" && globalContentLength > 0 && content === "" && (
              <button
                type="button"
                className="text-[10px] text-brand-600 underline decoration-dotted dark:text-brand-300"
                onClick={() => void loadGlobalIntoContent()}
              >
                以本体正文为基础
              </button>
            )}
            {scope === "global" && (
              <span className="text-[10px] text-zinc-400">
                版本化存储于 content_revisions
              </span>
            )}
          </div>
          <textarea
            className="textarea h-56"
            value={content}
            placeholder={
              scope === "overlay"
                ? "留空表示「未覆盖」，显示时使用节点本体正文"
                : "# 支持 Markdown\n\n- 记录要点"
            }
            onChange={(e) => setContent(e.target.value)}
          />
          <div className="mt-1 flex items-center justify-between text-[10px] text-zinc-400">
            <span>{content.length} 字</span>
            {!loaded && <span>载入中…</span>}
          </div>
        </div>

        {/* 可见性解释 */}
        {visibility && (
          <div
            className={cn(
              "rounded-lg border px-2.5 py-2 text-[11px]",
              isHidden
                ? "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300"
                : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
            )}
          >
            <div className="flex items-center gap-1 font-medium">
              <Info className="h-3 w-3" />
              可见性判定：规则 {visibility.rule} ·{" "}
              {VISIBILITY_META[visibility.reason]?.label ?? visibility.reason}
              <span className="ml-auto">
                {isHidden ? "当天隐藏" : "当天可见"}
              </span>
            </div>
            <p className="mt-1 opacity-80">{visibility.detail}</p>
            {visibility.sourceDate && (
              <p className="mt-0.5 opacity-80">出现段起始：{visibility.sourceDate}</p>
            )}
          </div>
        )}

        {/* 出现段与操作 */}
        {dayNode?.occurrence && (
          <div className="rounded-lg border border-zinc-200 px-2.5 py-2 text-[11px] dark:border-zinc-700">
            <div className="flex items-center gap-1.5">
              <span
                className={cn("badge", OCCURRENCE_SOURCE_META[dayNode.occurrence.source].badge)}
              >
                {OCCURRENCE_SOURCE_META[dayNode.occurrence.source].label}
              </span>
              <span className="text-zinc-500 dark:text-zinc-400">
                {formatMd(dayNode.occurrence.startDate)} →{" "}
                {dayNode.occurrence.endDate ? formatMd(dayNode.occurrence.endDate) : "持续"}
              </span>
              {dayNode.dayIndex && dayNode.dayIndex > 1 && (
                <span className="ml-auto text-zinc-400">第 {dayNode.dayIndex} 天</span>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className="btn"
            title="新增一个从明天开始的开放出现段"
            onClick={() => void useAppStore.getState().continueToNextDay(node.id)}
          >
            <ArrowRight className="h-3.5 w-3.5" />
            延续到明天
          </button>
          <button
            type="button"
            className="btn"
            title="让节点从今天起重新出现（手动重现，不自动生成）"
            onClick={() => void useAppStore.getState().reappearToday(node.id)}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            今天重新出现
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => void useAppStore.getState().deleteNode(node.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            删除节点
          </button>
        </div>

        <div className="space-y-0.5 rounded-lg bg-zinc-50 px-2.5 py-2 text-[10px] leading-relaxed text-zinc-500 dark:bg-zinc-800/50 dark:text-zinc-400">
          <div>ID：{node.id}</div>
          <div>创建：{formatTimestamp(node.createdAt)}</div>
          <div>更新：{formatTimestamp(node.updatedAt)}</div>
          {node.completedAt && <div>完成：{formatTimestamp(node.completedAt)}</div>}
          <div>正文文件：{node.contentPath ?? "（尚未生成）"}</div>
        </div>
      </div>

      {/* 保存条 */}
      <div className="flex items-center justify-between border-t border-zinc-100 px-3 py-2 dark:border-zinc-800">
        <span className={cn("text-[11px]", meta.text)}>
          {scope === "overlay" ? "保存为当日覆盖" : "保存到节点本体"}
        </span>
        <button
          type="button"
          className="btn btn-primary"
          disabled={saving}
          onClick={() => void handleSave()}
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? "保存中…" : "保存"}
        </button>
      </div>
    </div>
  );

  async function loadGlobalIntoContent() {
    if (!detailNodeId) return;
    const text = await api.getNodeContent(detailNodeId);
    setContent(text);
  }
}
