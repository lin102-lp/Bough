/** 应用外壳：顶栏 + 左列表 + 当天图 + 右面板。 */

import { useEffect } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

import { isTauri } from "@/api/commands";
import { CopyEdgesDialog } from "@/components/CopyEdgesDialog";
import { LeftPanel } from "@/components/LeftPanel";
import { PointDialog } from "@/components/PointDialog";
import { RightPanel } from "@/components/RightPanel";
import { SettingsDialog } from "@/components/SettingsDialog";
import { Toasts } from "@/components/Toasts";
import { TopBar } from "@/components/TopBar";
import { DayCanvas } from "@/graph/DayCanvas";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useAppStore } from "@/store/useAppStore";

export default function App() {
  const bootstrap = useAppStore((s) => s.bootstrap);
  const theme = useAppStore((s) => s.settings["theme"] ?? "system");
  const ready = useAppStore((s) => s.appInfo !== null);
  const error = useAppStore((s) => s.error);
  const clearError = useAppStore((s) => s.setError);

  useHotkeys();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // 主题
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      root.classList.toggle("dark", dark);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  if (!isTauri()) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertTriangle className="h-8 w-8 text-amber-500" />
        <h1 className="text-lg font-semibold">请通过 Tauri 启动桌面应用</h1>
        <p className="max-w-md text-sm text-zinc-500">
          当前页面运行在普通浏览器中，无法访问本地 SQLite 与 Markdown 文件。
          <br />
          请使用 <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">pnpm app:dev</code>{" "}
          启动，或 <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">pnpm app:build</code>{" "}
          打包。
        </p>
      </div>
    );
  }

  if (!ready && !error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
        <p className="text-sm text-zinc-500">正在打开本地数据库…</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopBar />

      {error && (
        <div className="flex items-center gap-2 border-b border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{error}</span>
          <button
            type="button"
            className="ml-auto shrink-0 underline decoration-dotted"
            onClick={() => clearError(null)}
          >
            知道了
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <LeftPanel />
        <main className="relative min-w-0 flex-1">
          <DayCanvas />
        </main>
        <RightPanel />
      </div>

      <CopyEdgesDialog />
      <PointDialog />
      <SettingsDialog />
      <Toasts />
    </div>
  );
}
