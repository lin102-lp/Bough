/** 全局快捷键（需求 7.4）。输入框聚焦时自动禁用，避免和输入冲突。 */

import { useEffect } from "react";

import { useAppStore } from "@/store/useAppStore";

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable === true
  );
}

export function useHotkeys() {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const store = useAppStore.getState();
      if (isTypingTarget(event.target)) return;

      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      // 撤销 / 重做
      if (mod && key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          void store.redo();
        } else {
          void store.undo();
        }
        return;
      }
      if (mod && key === "y") {
        event.preventDefault();
        void store.redo();
        return;
      }
      if (mod && key === "s") {
        event.preventDefault();
        store.pushToast({ kind: "info", message: "所有修改已自动保存" });
        return;
      }
      if (mod && key === "a") {
        event.preventDefault();
        store.selectAllVisible();
        return;
      }
      if (mod) return;

      switch (event.key) {
        case "ArrowLeft":
          event.preventDefault();
          void store.shiftDay(-1);
          return;
        case "ArrowRight":
          event.preventDefault();
          void store.shiftDay(1);
          return;
        case "Escape":
          if (store.connectMode) store.toggleConnectMode();
          store.clearSelection();
          return;
        case "Delete":
        case "Backspace": {
          if (store.selectedNodeIds.length > 0) {
            event.preventDefault();
            const ids = [...store.selectedNodeIds];
            void (async () => {
              for (const id of ids) {
                await store.deleteNode(id);
              }
            })();
          } else if (store.selectedEdgeIds.length > 0) {
            event.preventDefault();
            void store.deleteSelectedEdges();
          }
          return;
        }
        default:
          break;
      }

      switch (key) {
        case "n":
          event.preventDefault();
          void store.createNode();
          break;
        case "e":
          event.preventDefault();
          store.toggleConnectMode();
          break;
        case "c":
          event.preventDefault();
          void store.copyEdgesToNextDay();
          break;
        case "t":
          event.preventDefault();
          void store.goToday();
          break;
        case "h":
          event.preventDefault();
          store.setShowHidden(!store.showHidden);
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
