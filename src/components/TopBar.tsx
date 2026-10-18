/** 顶部栏：日期切换、搜索、撤销/重做、设置（需求 7.1）。 */

import { useEffect, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Redo2,
  Search,
  Settings,
  Undo2,
  X,
} from "lucide-react";

import { formatFull, relativeLabel, today as todayStr } from "@/lib/date";
import { cn } from "@/lib/util";
import { useAppStore } from "@/store/useAppStore";

export function TopBar() {
  const currentDate = useAppStore((s) => s.currentDate);
  const loading = useAppStore((s) => s.loading);
  const searchKeyword = useAppStore((s) => s.searchKeyword);
  const listCount = useAppStore((s) => s.nodeList.length);
  const undoLabel = useAppStore((s) =>
    s.undoStack.length > 0 ? s.undoStack[s.undoStack.length - 1].label : null,
  );
  const redoLabel = useAppStore((s) =>
    s.redoStack.length > 0 ? s.redoStack[s.redoStack.length - 1].label : null,
  );
  const historyBusy = useAppStore((s) => s.historyBusy);

  const [keyword, setKeyword] = useState(searchKeyword);

  // 搜索防抖：300ms 后刷新节点列表
  useEffect(() => {
    const timer = setTimeout(() => {
      const store = useAppStore.getState();
      store.setSearchKeyword(keyword);
      void store.refreshNodeList({ keyword: keyword || null });
    }, 300);
    return () => clearTimeout(timer);
  }, [keyword]);

  const isToday = currentDate === todayStr();

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 bg-white px-3 dark:border-zinc-800 dark:bg-zinc-900">
      {/* 日期导航 */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="btn btn-ghost !px-1.5"
          title="前一天（←）"
          onClick={() => void useAppStore.getState().shiftDay(-1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <div className="flex min-w-[260px] flex-col items-center leading-tight">
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-100">
              {formatFull(currentDate)}
            </span>
            {loading && <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />}
          </div>
          <span className="text-[10px] text-zinc-400">
            {relativeLabel(currentDate)}
            {isToday ? " · 正在记录" : ""}
          </span>
        </div>

        <button
          type="button"
          className="btn btn-ghost !px-1.5"
          title="后一天（→）"
          onClick={() => void useAppStore.getState().shiftDay(1)}
        >
          <ChevronRight className="h-4 w-4" />
        </button>

        <button
          type="button"
          className={cn("btn", isToday && "!border-brand-300 !text-brand-700 dark:!text-brand-300")}
          title="回到今天（T）"
          onClick={() => void useAppStore.getState().goToday()}
        >
          今天
        </button>

        <label className="btn cursor-pointer" title="日历跳转">
          <CalendarDays className="h-3.5 w-3.5" />
          <input
            type="date"
            value={currentDate}
            onChange={(e) => {
              if (e.target.value) void useAppStore.getState().setDate(e.target.value);
            }}
            className="w-[104px] cursor-pointer border-none bg-transparent text-xs outline-none dark:[color-scheme:dark]"
          />
        </label>
      </div>

      <div className="mx-1 h-6 w-px bg-zinc-200 dark:bg-zinc-700" />

      {/* 搜索 */}
      <div className="relative max-w-md flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
        <input
          className="input !py-1.5 pl-8 pr-16 text-[13px]"
          placeholder="搜索节点标题…"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        {keyword && (
          <>
            <span className="absolute right-8 top-1/2 -translate-y-1/2 text-[10px] text-zinc-400">
              {listCount}
            </span>
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
              onClick={() => setKeyword("")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!undoLabel || historyBusy}
          title={undoLabel ? `撤销：${undoLabel}（Ctrl+Z）` : "没有可撤销的操作"}
          onClick={() => void useAppStore.getState().undo()}
        >
          <Undo2 className="h-3.5 w-3.5" />
          撤销
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!redoLabel || historyBusy}
          title={redoLabel ? `重做：${redoLabel}（Ctrl+Shift+Z）` : "没有可重做的操作"}
          onClick={() => void useAppStore.getState().redo()}
        >
          <Redo2 className="h-3.5 w-3.5" />
          重做
        </button>
        <button
          type="button"
          className="btn btn-ghost !px-1.5"
          title="设置"
          onClick={() => useAppStore.getState().setSettingsOpen(true)}
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
