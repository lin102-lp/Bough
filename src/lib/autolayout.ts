/**
 * 日期图自动布局（需求 4.2.7：切换日期时若无布局则自动布局并保存）。
 *
 * 算法：基于当天边的分层布局（最长路径分层）
 * 1. Kahn 拓扑排序求每个节点的层级 = 最长前驱链长度
 * 2. 同层节点按顺序纵向排列，层与层之间横向间隔
 * 3. 环内节点（无法拓扑排序）按参与顺序补层，保证不会重叠
 *
 * 不依赖任何布局库，结果确定（同一天同一批数据每次结果一致）。
 */

export interface AutoLayoutOptions {
  xGap?: number;
  yGap?: number;
  originX?: number;
  originY?: number;
}

export interface Position {
  x: number;
  y: number;
}

export function computeAutoLayout(
  nodeIds: string[],
  edges: Array<{ from: string; to: string }>,
  options: AutoLayoutOptions = {},
): Record<string, Position> {
  const xGap = options.xGap ?? 300;
  const yGap = options.yGap ?? 150;
  const originX = options.originX ?? 80;
  const originY = options.originY ?? 80;

  const known = new Set(nodeIds);
  const validEdges = edges.filter((e) => known.has(e.from) && known.has(e.to) && e.from !== e.to);

  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const id of nodeIds) {
    outgoing.set(id, []);
    indegree.set(id, 0);
  }
  const seen = new Set<string>();
  for (const e of validEdges) {
    const key = `${e.from}->${e.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    outgoing.get(e.from)!.push(e.to);
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
  }

  // ---------- Kahn 拓扑 + 最长路径分层 ----------
  const level = new Map<string, number>();
  const queue: string[] = [];
  for (const id of nodeIds) {
    if ((indegree.get(id) ?? 0) === 0) {
      level.set(id, 0);
      queue.push(id);
    }
  }

  const remaining = new Map(indegree);
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const currentLevel = level.get(current) ?? 0;
    for (const next of outgoing.get(current) ?? []) {
      level.set(next, Math.max(level.get(next) ?? 0, currentLevel + 1));
      const left = (remaining.get(next) ?? 1) - 1;
      remaining.set(next, left);
      if (left === 0) queue.push(next);
    }
  }

  // ---------- 环内节点兜底 ----------
  const maxAssigned = Math.max(0, ...Array.from(level.values(), (v) => v));
  let fallbackLevel = maxAssigned + 1;
  for (const id of nodeIds) {
    if (!level.has(id)) {
      level.set(id, fallbackLevel);
    }
  }

  // ---------- 分配坐标 ----------
  const byLevel = new Map<number, string[]>();
  for (const id of nodeIds) {
    const l = level.get(id) ?? 0;
    if (!byLevel.has(l)) byLevel.set(l, []);
    byLevel.get(l)!.push(id);
  }

  const positions: Record<string, Position> = {};
  const levels = Array.from(byLevel.keys()).sort((a, b) => a - b);
  for (const l of levels) {
    const ids = byLevel.get(l)!;
    // 同层以「连通度高的居中」排序，视觉更稳
    ids.sort((a, b) => {
      const da = (outgoing.get(a) ?? []).length;
      const db = (outgoing.get(b) ?? []).length;
      if (da !== db) return db - da;
      return a.localeCompare(b);
    });
    const total = ids.length;
    ids.forEach((id, index) => {
      const offset = (index - (total - 1) / 2) * yGap;
      positions[id] = {
        x: originX + l * xGap,
        y: originY + 320 + offset,
      };
    });
  }

  return positions;
}

/** 增量补齐：只给没有布局的节点算坐标，已存在的保持不动 */
export function computeMissingLayout(
  existing: Record<string, Position>,
  nodeIds: string[],
  edges: Array<{ from: string; to: string }>,
  options: AutoLayoutOptions = {},
): Record<string, Position> {
  const missing = nodeIds.filter((id) => !existing[id]);
  if (missing.length === 0) return {};
  const computed = computeAutoLayout(missing, edges, options);
  return computed;
}
