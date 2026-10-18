/** React Flow 自定义节点 / 边的类型定义。 */

import type { Edge, Node } from "@xyflow/react";

import type { DayEdgeView, DayNode, NodeStatus } from "@/types";

export type TTNodeData = {
  dayNode: DayNode;
  preview: string;
  /** 该节点当天是隐藏的（仅在「显示隐藏节点」打开时渲染） */
  hiddenOnly: boolean;
  /** 当前处于连线模式且已选中该节点作为起点 */
  connectSource: boolean;
  connectMode: boolean;
  onToggleStatus: (id: string, status: NodeStatus) => void;
  onToggleStar: (id: string) => void;
  onContinue: (id: string) => void;
  onOpenDetail: (id: string) => void;
  onSetVisible: (id: string, visible: boolean) => void;
  onConnectPick: (id: string) => void;
};

export type TTNode = Node<TTNodeData, "ttNode">;

export type TTEdgeData = {
  view: DayEdgeView;
  fromTitle: string;
  toTitle: string;
  onDelete: (id: string) => void;
};

export type TTEdge = Edge<TTEdgeData, "ttEdge">;

export const NODE_TYPE = "ttNode";
export const EDGE_TYPE = "ttEdge";
