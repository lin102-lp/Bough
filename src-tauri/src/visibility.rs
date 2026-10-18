//! 可见性状态机（需求 4.2.6 / 4.1.10）
//!
//! 判定输入：节点 + 日期；输出：可见 / 隐藏 + 命中原因 + 优先级序号。
//!
//! 优先级从高到低：
//! 1. 软删除                       → 隐藏
//! 2. 已取消                       → 隐藏（历史日期也隐藏）
//! 3. 当日覆盖 `visible = false`   → 隐藏
//! 4. 已完成 + 自动延续（且日期晚于完成日）→ 隐藏
//! 5. 父节点跟随                   → 可见 / 不可见（阶段 1 默认关闭）
//! 6. 出现段覆盖                   → 可见（含「自动延续动态可见」）
//! 7. 默认隐藏
//!
//! 设计要点：
//! - **不物化每日出现段**：自动延续靠「开放出现段（end_date 为空）+ 未完成」动态判定；
//! - 递归求父节点可见性时带访问栈，防止环（需求 11. 子节点跟随递归死循环）；
//! - 结果带缓存，同一个日期视图内每个节点只算一次（需求 5.1 性能）。

use crate::models::{
    Continuation, DayOverlay, FollowMode, Node, NodeStatus, Occurrence, OccurrenceSource,
    VisibilityOptions, VisibilityReason, VisibilityResult,
};
use crate::util;
use std::collections::HashMap;

/// 判定上下文：一次日期视图查询内构建一次，复用给所有节点。
pub struct VisibilityContext<'a> {
    pub date: &'a str,
    pub nodes: &'a HashMap<String, Node>,
    /// 当日覆盖：node_id → overlay
    pub overlays: &'a HashMap<String, DayOverlay>,
    /// 覆盖该日期的出现段：node_id → 出现段列表
    pub coverings: &'a HashMap<String, Vec<Occurrence>>,
    /// 子节点跟随覆盖：node_id → mode
    pub follow_overrides: &'a HashMap<String, FollowMode>,
    pub options: VisibilityOptions,
    cache: HashMap<String, VisibilityResult>,
}

impl<'a> VisibilityContext<'a> {
    pub fn new(
        date: &'a str,
        nodes: &'a HashMap<String, Node>,
        overlays: &'a HashMap<String, DayOverlay>,
        coverings: &'a HashMap<String, Vec<Occurrence>>,
        follow_overrides: &'a HashMap<String, FollowMode>,
        options: VisibilityOptions,
    ) -> Self {
        Self {
            date,
            nodes,
            overlays,
            coverings,
            follow_overrides,
            options,
            cache: HashMap::new(),
        }
    }

    /// 判定某节点在该日期是否可见。
    pub fn evaluate(&mut self, node_id: &str) -> VisibilityResult {
        let mut visiting: Vec<String> = Vec::new();
        self.eval(node_id, &mut visiting)
    }

    /// 批量判定。
    pub fn evaluate_all(&mut self, node_ids: &[String]) -> HashMap<String, VisibilityResult> {
        let mut out = HashMap::with_capacity(node_ids.len());
        for id in node_ids {
            let r = self.evaluate(id);
            out.insert(id.clone(), r);
        }
        out
    }

    fn eval(&mut self, node_id: &str, visiting: &mut Vec<String>) -> VisibilityResult {
        if let Some(hit) = self.cache.get(node_id) {
            return hit.clone();
        }
        visiting.push(node_id.to_string());
        let result = self.compute(node_id, visiting);
        visiting.pop();
        self.cache.insert(node_id.to_string(), result.clone());
        result
    }

    fn compute(&mut self, node_id: &str, visiting: &mut Vec<String>) -> VisibilityResult {
        let date = self.date.to_string();

        // 节点必须存在（调用方通常已过滤，这里兜底）
        let node = match self.nodes.get(node_id) {
            Some(n) => n.clone(),
            None => {
                return VisibilityResult::hidden(
                    VisibilityReason::DefaultHidden,
                    7,
                    "节点不存在或已被物理删除",
                )
            }
        };

        // ---------- 规则 1：软删除 ----------
        if node.deleted_at.is_some() {
            return VisibilityResult::hidden(
                VisibilityReason::SoftDeleted,
                1,
                "节点已软删除（可在回收站恢复）",
            );
        }

        // ---------- 规则 2：已取消 ----------
        if node.status == NodeStatus::Cancelled {
            return VisibilityResult::hidden(
                VisibilityReason::Cancelled,
                2,
                "节点已取消，默认隐藏（可用筛选器显示）",
            );
        }

        // ---------- 规则 3：当日覆盖 visible = false ----------
        if let Some(overlay) = self.overlays.get(node_id) {
            if overlay.visible == Some(false) {
                return VisibilityResult::hidden(
                    VisibilityReason::OverlayHidden,
                    3,
                    "当日覆盖显式设置 visible = false",
                );
            }
            // ---------- 规则 3.5：当日覆盖「临时可见」 ----------
            // 需求 4.4.4：指向目标节点当天不可见时，可打一个「临时可见」标记，
            // 仅当天显示、不生成出现段，且可随时撤销（清除当日覆盖即撤销）。
            if overlay.force_visible {
                return VisibilityResult::shown(
                    VisibilityReason::OverlayForceVisible,
                    3,
                    "当日覆盖设置「临时可见」（指向时使用，不生成出现段）",
                );
            }
        }

        // 覆盖该日期的出现段（start <= date 且 (end 为空 或 end >= date)）
        let coverings: Vec<Occurrence> = self.coverings.get(node_id).cloned().unwrap_or_default();
        // 只保留真正覆盖该日期的段。调用方（repo::occurrences::covering_map）已经过滤过，
        // 这里再校验一次，保证引擎在任何输入下都正确。
        let active: Vec<Occurrence> = coverings
            .iter()
            .filter(|o| occurrence_covers(o, &date))
            .cloned()
            .collect();

        // ---------- 规则 4：已完成（停止自动延续） ----------
        // 文档原文限定「延续策略为自动」，这里补一条等价约束：
        // 只要存在覆盖该日期、且起始日不晚于完成日的**开放段**，完成之后也不应继续出现，
        // 否则「重新出现」产生的开放段会让已完成节点永久可见。
        // 反例保护：若某段起始日晚于完成日（= 完成后被手动重新激活），则规则 4 不生效。
        if node.status == NodeStatus::Done {
            if let Some(done_date) = node.completed_at.as_deref().and_then(util::iso_to_date) {
                if date.as_str() > done_date.as_str() {
                    let reactivated = active
                        .iter()
                        .any(|o| o.start_date.as_str() > done_date.as_str());
                    let auto_leak = node.continuation == Continuation::Auto;
                    let open_leak = active.iter().any(|o| {
                        o.end_date.is_none() && o.start_date.as_str() <= done_date.as_str()
                    });
                    if !reactivated && (auto_leak || open_leak) {
                        return VisibilityResult::hidden(
                            VisibilityReason::CompletedAutoStop,
                            4,
                            format!("节点已于 {done_date} 完成，自动延续已停止"),
                        );
                    }
                }
            }
        }

        // ---------- 规则 5：父节点跟随 ----------
        if self.options.parent_follow {
            if let Some(parent_id) = node.parent_id.clone() {
                let mode = self
                    .follow_overrides
                    .get(node_id)
                    .copied()
                    .unwrap_or(FollowMode::Default);
                // 防止父链成环导致的无限递归
                let in_stack = visiting.iter().any(|v| v == &parent_id);
                if !in_stack {
                    let parent_visible = self.eval(&parent_id, visiting).visible;
                    let explicitly_detached =
                        matches!(mode, FollowMode::Never | FollowMode::Independent);
                    if parent_visible && !explicitly_detached {
                        return VisibilityResult::shown(
                            VisibilityReason::ParentFollow,
                            5,
                            "父节点当天可见，按跟随模式一同出现",
                        )
                        .with_parent(Some(parent_id));
                    }
                    // 默认/跟随模式下，父节点不可见 → 子节点也不可见
                    if !parent_visible
                        && matches!(mode, FollowMode::Default | FollowMode::Follow)
                    {
                        return VisibilityResult::hidden(
                            VisibilityReason::ParentFollowHidden,
                            5,
                            "父节点当天不可见，子节点跟随隐藏",
                        )
                        .with_parent(Some(parent_id));
                    }
                }
            }
        }

        // ---------- 规则 6：出现段覆盖 ----------
        // 取「起始日最晚」的段优先（更具体者胜出）；
        // 若该段因开关关闭而不成立（如关闭自动延续后只剩开放段），继续尝试更早的段。
        let mut sorted = active;
        sorted.sort_by(|a, b| b.start_date.cmp(&a.start_date));
        for occ in sorted.iter() {
            if let Some(result) = self.classify_occurrence(&node, occ, &date) {
                return result;
            }
        }

        // ---------- 规则 7：默认隐藏 ----------
        VisibilityResult::hidden(
            VisibilityReason::DefaultHidden,
            7,
            "没有覆盖该日期的出现段，也没有开启自动延续",
        )
    }

    /// 判断单个出现段能否让节点在该日期可见。
    fn classify_occurrence(
        &self,
        node: &Node,
        occ: &Occurrence,
        date: &str,
    ) -> Option<VisibilityResult> {
        // 防御性校验：不覆盖该日期的段一律不参与判定
        if !occurrence_covers(occ, date) {
            return None;
        }
        let is_open = occ.end_date.is_none();
        let is_start_day = occ.start_date.as_str() == date;

        match occ.source {
            // 自动延续：
            // - 起始日直接可见
            // - 闭段（例如完成时被截断的段）覆盖区间内的历史日期仍可见（需求 4.1.9）
            // - 开放段 + 未完成 → 后续日期动态可见（不物化每日出现段）
            OccurrenceSource::Auto => {
                if is_start_day {
                    Some(
                        VisibilityResult::shown(
                            VisibilityReason::OccurrenceCover,
                            6,
                            "出现段起始日",
                        )
                        .with_occurrence(occ),
                    )
                } else if !is_open {
                    Some(
                        VisibilityResult::shown(
                            VisibilityReason::OccurrenceCover,
                            6,
                            format!(
                                "历史日期落在出现段区间内（{} ~ {}）",
                                occ.start_date,
                                occ.end_date.clone().unwrap_or_default()
                            ),
                        )
                        .with_occurrence(occ),
                    )
                } else if !self.options.auto_continuation {
                    // 阶段 1 简化模式：关闭自动延续后，开放段只保留起始日语义
                    None
                } else {
                    Some(
                        VisibilityResult::shown(
                            VisibilityReason::AutoContinuation,
                            6,
                            format!("自动延续中（自 {} 起，未完成）", occ.start_date),
                        )
                        .with_occurrence(occ),
                    )
                }
            }
            // 手动延续 / 手动出现段
            OccurrenceSource::Manual => Some(
                VisibilityResult::shown(
                    VisibilityReason::OccurrenceCover,
                    6,
                    if is_open {
                        format!("手动延续中（自 {}）", occ.start_date)
                    } else {
                        "手动出现段".to_string()
                    },
                )
                .with_occurrence(occ),
            ),
            // 手动重新出现
            OccurrenceSource::Reappear => Some(
                VisibilityResult::shown(
                    VisibilityReason::OccurrenceCover,
                    6,
                    "手动重新出现",
                )
                .with_occurrence(occ),
            ),
            // 跟随父节点而物化的出现段（阶段 2 才会写入）
            OccurrenceSource::Follow => {
                if self.options.parent_follow {
                    Some(
                        VisibilityResult::shown(
                            VisibilityReason::ParentFollow,
                            5,
                            "跟随父节点出现的物化出现段",
                        )
                        .with_occurrence(occ)
                        .with_parent(node.parent_id.clone()),
                    )
                } else {
                    None
                }
            }
        }
    }
}

/// 判断某个出现段是否覆盖指定日期。
pub fn occurrence_covers(occ: &Occurrence, date: &str) -> bool {
    occ.start_date.as_str() <= date && occ.end_date.as_deref().map_or(true, |e| e >= date)
}

/// 便捷函数：单节点判定（内部构建一次性上下文，主要用于测试与时间树）。
pub fn evaluate_single(
    date: &str,
    node: &Node,
    overlay: Option<&DayOverlay>,
    coverings: &[Occurrence],
    options: VisibilityOptions,
) -> VisibilityResult {
    let mut nodes = HashMap::new();
    nodes.insert(node.id.clone(), node.clone());
    let mut overlays = HashMap::new();
    if let Some(o) = overlay {
        overlays.insert(node.id.clone(), o.clone());
    }
    let mut cov: HashMap<String, Vec<Occurrence>> = HashMap::new();
    cov.insert(node.id.clone(), coverings.to_vec());
    let follow = HashMap::new();
    let mut ctx = VisibilityContext::new(date, &nodes, &overlays, &cov, &follow, options);
    ctx.evaluate(&node.id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(id: &str, status: NodeStatus, continuation: Continuation) -> Node {
        Node {
            id: id.into(),
            title: id.into(),
            content_path: None,
            starred: false,
            status,
            completed_at: None,
            continuation,
            parent_id: None,
            created_at: "2026-10-01T00:00:00+08:00".into(),
            updated_at: "2026-10-01T00:00:00+08:00".into(),
            deleted_at: None,
        }
    }

    fn occ(id: i64, start: &str, end: Option<&str>, source: OccurrenceSource) -> Occurrence {
        Occurrence {
            id,
            node_id: "n1".into(),
            start_date: start.into(),
            end_date: end.map(|s| s.to_string()),
            source,
            is_manual_reappear: source == OccurrenceSource::Reappear,
            created_at: "2026-10-01T00:00:00+08:00".into(),
            updated_at: "2026-10-01T00:00:00+08:00".into(),
        }
    }

    #[test]
    fn open_auto_segment_is_visible_next_day() {
        let n = node("n1", NodeStatus::Todo, Continuation::Auto);
        let segs = vec![occ(1, "2026-10-01", None, OccurrenceSource::Auto)];
        let r = evaluate_single(
            "2026-10-05",
            &n,
            None,
            &segs,
            VisibilityOptions::default(),
        );
        assert!(r.visible);
        assert_eq!(r.reason, VisibilityReason::AutoContinuation);
    }

    #[test]
    fn auto_continuation_can_be_disabled_for_stage1() {
        let n = node("n1", NodeStatus::Todo, Continuation::Auto);
        let segs = vec![occ(1, "2026-10-01", None, OccurrenceSource::Auto)];
        let opts = VisibilityOptions {
            auto_continuation: false,
            parent_follow: false,
        };
        assert!(evaluate_single("2026-10-01", &n, None, &segs, opts).visible);
        assert!(!evaluate_single("2026-10-05", &n, None, &segs, opts).visible);
    }

    #[test]
    fn done_node_stops_after_completion_date() {
        let mut n = node("n1", NodeStatus::Done, Continuation::Auto);
        n.completed_at = Some("2026-10-03T10:00:00+08:00".into());
        let segs = vec![occ(1, "2026-10-01", None, OccurrenceSource::Auto)];
        assert!(evaluate_single("2026-10-03", &n, None, &segs, VisibilityOptions::default()).visible);
        let r = evaluate_single("2026-10-04", &n, None, &segs, VisibilityOptions::default());
        assert!(!r.visible);
        assert_eq!(r.reason, VisibilityReason::CompletedAutoStop);
        assert_eq!(r.rule, 4);
    }

    #[test]
    fn completed_node_can_be_reactivated_by_new_segment() {
        let mut n = node("n1", NodeStatus::Done, Continuation::Reappear);
        n.completed_at = Some("2026-10-03T10:00:00+08:00".into());
        let segs = vec![
            occ(1, "2026-10-01", None, OccurrenceSource::Auto),
            occ(2, "2026-10-06", None, OccurrenceSource::Reappear),
        ];
        assert!(evaluate_single("2026-10-07", &n, None, &segs, VisibilityOptions::default()).visible);
        assert!(!evaluate_single("2026-10-04", &n, None, &segs, VisibilityOptions::default()).visible);
    }

    #[test]
    fn cancelled_and_deleted_win_over_everything() {
        let mut n = node("n1", NodeStatus::Cancelled, Continuation::Auto);
        let segs = vec![occ(1, "2026-10-01", None, OccurrenceSource::Auto)];
        let r = evaluate_single("2026-10-02", &n, None, &segs, VisibilityOptions::default());
        assert!(!r.visible);
        assert_eq!(r.reason, VisibilityReason::Cancelled);

        n.status = NodeStatus::Todo;
        n.deleted_at = Some("2026-10-02T00:00:00+08:00".into());
        let r = evaluate_single("2026-10-02", &n, None, &segs, VisibilityOptions::default());
        assert!(!r.visible);
        assert_eq!(r.reason, VisibilityReason::SoftDeleted);
    }

    #[test]
    fn overlay_false_hides_even_with_open_segment() {
        let n = node("n1", NodeStatus::Todo, Continuation::Auto);
        let segs = vec![occ(1, "2026-10-01", None, OccurrenceSource::Auto)];
        let overlay = DayOverlay {
            node_id: "n1".into(),
            date: "2026-10-02".into(),
            title: None,
            content: None,
            visible: Some(false),
            force_visible: false,
            sort_order: None,
            style_json: None,
            created_at: "2026-10-02T00:00:00+08:00".into(),
            updated_at: "2026-10-02T00:00:00+08:00".into(),
        };
        let r = evaluate_single(
            "2026-10-02",
            &n,
            Some(&overlay),
            &segs,
            VisibilityOptions::default(),
        );
        assert!(!r.visible);
        assert_eq!(r.reason, VisibilityReason::OverlayHidden);
    }

    #[test]
    fn force_visible_makes_node_show_without_occurrence() {
        let n = node("n1", NodeStatus::Todo, Continuation::None);
        // 没有任何出现段覆盖 10-05
        let segs = vec![occ(1, "2026-10-01", Some("2026-10-01"), OccurrenceSource::Manual)];
        let overlay = DayOverlay {
            node_id: "n1".into(),
            date: "2026-10-05".into(),
            title: None,
            content: None,
            visible: None,
            force_visible: true,
            sort_order: None,
            style_json: None,
            created_at: "2026-10-05T00:00:00+08:00".into(),
            updated_at: "2026-10-05T00:00:00+08:00".into(),
        };
        let r = evaluate_single(
            "2026-10-05",
            &n,
            Some(&overlay),
            &segs,
            VisibilityOptions::default(),
        );
        assert!(r.visible);
        assert_eq!(r.reason, VisibilityReason::OverlayForceVisible);
        // 只影响当天
        let other = evaluate_single("2026-10-06", &n, None, &segs, VisibilityOptions::default());
        assert!(!other.visible);
    }

    #[test]
    fn closed_segment_only_covers_its_range() {
        let n = node("n1", NodeStatus::Todo, Continuation::None);
        let segs = vec![occ(1, "2026-10-01", Some("2026-10-03"), OccurrenceSource::Manual)];
        assert!(evaluate_single("2026-10-02", &n, None, &segs, VisibilityOptions::default()).visible);
        assert!(!evaluate_single("2026-10-04", &n, None, &segs, VisibilityOptions::default()).visible);
    }
}
