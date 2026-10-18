/** 设置弹窗（需求 4.8）。 */

import { useEffect, useState } from "react";
import { Database, FolderOpen, HardDriveDownload, Keyboard, X } from "lucide-react";

import * as api from "@/api/commands";
import { CONTINUATION_META } from "@/lib/labels";
import { cn } from "@/lib/util";
import { useAppStore } from "@/store/useAppStore";
import type { AppInfo, BackupInfo, Continuation } from "@/types";

const SHORTCUTS: Array<[string, string]> = [
  ["← / →", "切换前一天 / 后一天"],
  ["T", "回到今天"],
  ["N", "新建节点"],
  ["E", "连线模式"],
  ["C", "复制当天边到明天"],
  ["H", "显示 / 隐藏被判定不可见的节点"],
  ["Delete", "删除选中节点 / 边"],
  ["Ctrl + Z", "撤销"],
  ["Ctrl + Shift + Z", "重做"],
  ["Ctrl + A", "全选当天可见节点"],
  ["Esc", "取消选择 / 退出连线模式"],
];

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-zinc-200 px-2.5 py-2 dark:border-zinc-700">
      <input
        type="checkbox"
        className="mt-0.5 h-3.5 w-3.5 accent-brand-600"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        <span className="block text-[12px] font-medium text-zinc-700 dark:text-zinc-200">
          {label}
        </span>
        <span className="block text-[10px] leading-relaxed text-zinc-400">{hint}</span>
      </span>
    </label>
  );
}

export function SettingsDialog() {
  const open = useAppStore((s) => s.settingsOpen);
  const settings = useAppStore((s) => s.settings);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        setInfo(await api.getAppInfo());
        setBackups(await api.listBackups());
      } catch {
        // 忽略：浏览器环境下没有后端
      }
    })();
  }, [open]);

  if (!open) return null;

  const setValue = (key: string, value: string) =>
    void useAppStore.getState().setSettingValue(key, value);
  const theme = settings["theme"] ?? "system";

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/20 p-6 backdrop-blur-sm">
      <div className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">设置</h2>
          <button
            type="button"
            className="btn btn-ghost !px-1.5"
            onClick={() => useAppStore.getState().setSettingsOpen(false)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {/* 默认值 */}
          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
              默认行为
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">默认延续策略</label>
                <select
                  className="input"
                  value={settings["default_continuation"] ?? "auto"}
                  onChange={(e) => setValue("default_continuation", e.target.value)}
                >
                  {(Object.keys(CONTINUATION_META) as Continuation[]).map((c) => (
                    <option key={c} value={c}>
                      {CONTINUATION_META[c].label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">默认编辑模式</label>
                <select
                  className="input"
                  value={settings["default_edit_mode"] ?? "day_overlay"}
                  onChange={(e) => setValue("default_edit_mode", e.target.value)}
                >
                  <option value="day_overlay">当日局部编辑</option>
                  <option value="global">编辑节点本体</option>
                </select>
              </div>
              <div>
                <label className="label">主题</label>
                <select
                  className="input"
                  value={theme}
                  onChange={(e) => setValue("theme", e.target.value)}
                >
                  <option value="system">跟随系统</option>
                  <option value="light">浅色</option>
                  <option value="dark">深色</option>
                </select>
              </div>
              <div>
                <label className="label">每周起始日</label>
                <select
                  className="input"
                  value={settings["week_start"] ?? "1"}
                  onChange={(e) => setValue("week_start", e.target.value)}
                >
                  <option value="1">周一</option>
                  <option value="0">周日</option>
                </select>
              </div>
            </div>
          </section>

          {/* 可见性引擎开关 */}
          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
              可见性状态机（需求 4.2.6）
            </h3>
            <Toggle
              label="自动延续动态可见"
              hint="开放出现段 + 未完成 → 后续日期动态可见，且不物化每日出现段。关闭后只有出现段起始日可见（阶段 1 最简语义）。"
              checked={(settings["visibility.auto_continuation"] ?? "1") === "1"}
              onChange={(v) => setValue("visibility.auto_continuation", v ? "1" : "0")}
            />
            <Toggle
              label="子节点跟随父节点"
              hint="规则 5：父节点当天可见时，处于默认/跟随模式的子节点一同出现（阶段 2 功能，默认关闭）。"
              checked={(settings["visibility.parent_follow"] ?? "0") === "1"}
              onChange={(v) => setValue("visibility.parent_follow", v ? "1" : "0")}
            />
            <Toggle
              label="默认显示隐藏节点"
              hint="在日期图中以虚线卡片显示被判定为不可见的节点，便于排查。"
              checked={(settings["ui.show_hidden"] ?? "0") === "1"}
              onChange={(v) => useAppStore.getState().setShowHidden(v)}
            />
          </section>

          {/* 数据与备份 */}
          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
              数据与备份
            </h3>
            <div className="space-y-1 rounded-lg border border-zinc-200 px-2.5 py-2 text-[11px] text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
              <div className="flex items-center gap-1.5">
                <Database className="h-3 w-3" /> 数据库：{info?.dbPath ?? "…"}
              </div>
              <div className="flex items-center gap-1.5">
                <FolderOpen className="h-3 w-3" /> 正文目录：{info?.notesDir ?? "…"}
              </div>
              <div className="flex items-center gap-1.5">
                <FolderOpen className="h-3 w-3" /> 覆盖目录：{info?.overlaysDir ?? "…"}
              </div>
              <div>
                schema 版本：v{info?.schemaVersion ?? "?"} · 应用版本 {info?.version ?? "?"}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void (async () => {
                    try {
                      const backup = await api.createBackup("manual");
                      setBackups(await api.listBackups());
                      useAppStore.getState().pushToast({
                        kind: "success",
                        message: "备份完成",
                        detail: backup.path,
                      });
                    } catch (error) {
                      useAppStore.getState().pushToast({
                        kind: "error",
                        message: "备份失败",
                        detail: error instanceof Error ? error.message : String(error),
                      });
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}
              >
                <HardDriveDownload className="h-3.5 w-3.5" />
                {busy ? "备份中…" : "立即备份"}
              </button>
              <span className="text-[10px] text-zinc-400">
                已有 {backups.length} 份备份（数据库 + notes + overlays）
              </span>
            </div>
          </section>

          {/* 快捷键 */}
          <section className="space-y-2">
            <h3 className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
              <Keyboard className="h-3 w-3" />
              快捷键
            </h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {SHORTCUTS.map(([key, desc]) => (
                <div key={key} className="flex items-center justify-between text-[11px]">
                  <span className="text-zinc-500 dark:text-zinc-400">{desc}</span>
                  <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
                    {key}
                  </kbd>
                </div>
              ))}
            </div>
            <p className={cn("text-[10px] text-zinc-400")}>
              输入框聚焦时全局快捷键自动禁用，避免与输入冲突。
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
