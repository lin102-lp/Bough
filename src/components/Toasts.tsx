/** 轻量 Toast 通知。 */

import { useEffect } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";

import { cn } from "@/lib/util";
import { useAppStore } from "@/store/useAppStore";
import type { Toast } from "@/types";

const ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
} as const;

const STYLES = {
  info: "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200",
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  warning:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
  error:
    "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200",
} as const;

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useAppStore((s) => s.dismissToast);
  const Icon = ICONS[toast.kind];

  useEffect(() => {
    const timer = setTimeout(() => dismiss(toast.id), toast.kind === "error" ? 6500 : 3200);
    return () => clearTimeout(timer);
  }, [toast.id, toast.kind, dismiss]);

  return (
    <div
      className={cn(
        "pointer-events-auto flex w-[320px] items-start gap-2 rounded-xl border px-3 py-2 shadow-lg animate-fade-in",
        STYLES[toast.kind],
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium leading-snug">{toast.message}</p>
        {toast.detail && (
          <p className="mt-0.5 break-words text-[11px] opacity-80">{toast.detail}</p>
        )}
      </div>
      <button
        type="button"
        className="shrink-0 opacity-60 transition hover:opacity-100"
        onClick={() => dismiss(toast.id)}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function Toasts() {
  const toasts = useAppStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
