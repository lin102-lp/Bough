/** 当天边（React Flow 自定义边）：普通边 / 指向边 / 双向边。 */

import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";

import { cn } from "@/lib/util";

import type { TTEdge } from "./types";

export const DayEdgeView = memo(function DayEdgeView({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerEnd,
  markerStart,
}: EdgeProps<TTEdge>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const view = data?.view;
  const isPoint = view?.edge.type === "point";
  const isBidirectional = view?.bidirectional ?? false;
  const isCopy = Boolean(view?.edge.copiedFromDate);

  const stroke = isPoint ? "#8b5cf6" : "#71717a";
  const strokeWidth = selected ? 2.4 : isPoint ? 1.8 : 1.5;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        markerStart={isBidirectional ? markerStart : undefined}
        style={{
          stroke,
          strokeWidth,
          strokeDasharray: isPoint ? "6 4" : isCopy ? "2 3" : undefined,
          opacity: view && (!view.fromVisible || !view.toVisible) ? 0.45 : 1,
        }}
      />
      {(isPoint || isBidirectional) && (
        <EdgeLabelRenderer>
          <div
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
            }}
            className="absolute"
          >
            <span
              className={cn(
                "badge border shadow-sm",
                isPoint
                  ? "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300"
                  : "border-zinc-200 bg-white text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400",
              )}
            >
              {isPoint ? "指向" : "双向"}
            </span>
          </div>
        </EdgeLabelRenderer>
      )}
      {data && (!view?.fromVisible || !view?.toVisible) && (
        <EdgeLabelRenderer>
          <div
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY + 14}px)`,
              pointerEvents: "none",
            }}
            className="absolute"
          >
            <span className="badge bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              端点当天不可见
            </span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
