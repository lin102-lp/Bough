//! 数据库迁移：按版本号顺序执行，用 `schema_migrations` 记录已应用版本。
//!
//! 约定：
//! - 每个迁移是一个独立事务，失败整体回滚；
//! - 迁移前由 `state::bootstrap` 自动备份数据库文件（需求 4.6、5.2）；
//! - `MIGRATIONS` 只能追加，不能修改已发布的历史版本。

use crate::error::{AppError, AppResult};
use rusqlite::Connection;

pub struct Migration {
    pub version: i64,
    pub name: &'static str,
    pub sql: &'static str,
}

/// v1：阶段 1 核心表结构 + 阶段 2 预留表（表结构一次到位，避免后续加表迁移）
const V1_INIT: &str = r#"
-- ============================================================
-- 6.1 节点表：
-- ============================================================
CREATE TABLE IF NOT EXISTS nodes (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL DEFAULT '',
    content_path  TEXT,
    starred       INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'todo'
                  CHECK (status IN ('todo','doing','done','cancelled')),
    completed_at  TEXT,
    continuation  TEXT NOT NULL DEFAULT 'auto'
                  CHECK (continuation IN ('auto','manual','none','reappear')),
    parent_id     TEXT REFERENCES nodes(id) ON DELETE SET NULL,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_nodes_parent    ON nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_nodes_status    ON nodes(status);
CREATE INDEX IF NOT EXISTS idx_nodes_starred   ON nodes(starred);
CREATE INDEX IF NOT EXISTS idx_nodes_deleted   ON nodes(deleted_at);
CREATE INDEX IF NOT EXISTS idx_nodes_updated   ON nodes(updated_at);

-- ============================================================
-- 6.2 出现段表：
-- ============================================================
CREATE TABLE IF NOT EXISTS occurrences (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id            TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    start_date         TEXT NOT NULL,
    end_date           TEXT,
    source             TEXT NOT NULL DEFAULT 'manual'
                       CHECK (source IN ('auto','manual','reappear','follow')),
    is_manual_reappear INTEGER NOT NULL DEFAULT 0,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL,
    UNIQUE (node_id, start_date)
);
CREATE INDEX IF NOT EXISTS idx_occ_node       ON occurrences(node_id);
CREATE INDEX IF NOT EXISTS idx_occ_range      ON occurrences(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_occ_node_start ON occurrences(node_id, start_date);

-- ============================================================
-- 6.3 当日覆盖表：
-- ============================================================
CREATE TABLE IF NOT EXISTS day_overlays (
    node_id    TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    date       TEXT NOT NULL,
    title      TEXT,
    content    TEXT,
    visible    INTEGER,
    sort_order INTEGER,
    style_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (node_id, date)
);
CREATE INDEX IF NOT EXISTS idx_overlay_date ON day_overlays(date);

-- ============================================================
-- 6.4 当天边表：
-- ============================================================
CREATE TABLE IF NOT EXISTS day_edges (
    id               TEXT PRIMARY KEY,
    date             TEXT NOT NULL,
    from_node_id     TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    to_node_id       TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    type             TEXT NOT NULL DEFAULT 'single'
                     CHECK (type IN ('single','point')),
    group_id         TEXT,
    copied_from_date TEXT,
    batch_id         TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,
    deleted_at       TEXT
);
-- 唯一约束需考虑软删除 → 部分唯一索引
CREATE UNIQUE INDEX IF NOT EXISTS uq_day_edges_alive
    ON day_edges(date, from_node_id, to_node_id, type)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_edges_date      ON day_edges(date);
CREATE INDEX IF NOT EXISTS idx_edges_date_from ON day_edges(date, from_node_id);
CREATE INDEX IF NOT EXISTS idx_edges_date_to   ON day_edges(date, to_node_id);
CREATE INDEX IF NOT EXISTS idx_edges_from      ON day_edges(from_node_id);
CREATE INDEX IF NOT EXISTS idx_edges_to        ON day_edges(to_node_id);
CREATE INDEX IF NOT EXISTS idx_edges_batch     ON day_edges(batch_id);

-- ============================================================
-- 6.12 日期节点布局表：
-- ============================================================
CREATE TABLE IF NOT EXISTS day_node_layout (
    date       TEXT NOT NULL,
    node_id    TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    x          REAL NOT NULL DEFAULT 0,
    y          REAL NOT NULL DEFAULT 0,
    collapsed  INTEGER NOT NULL DEFAULT 0,
    z_index    INTEGER,
    anchor     TEXT,
    level      INTEGER,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (date, node_id)
);
CREATE INDEX IF NOT EXISTS idx_layout_date ON day_node_layout(date);

-- ============================================================
-- 6.7 设置表：
-- ============================================================
CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- ============================================================
-- 6.5 操作记录表（阶段 2 使用：只存元数据与 diff 引用，不存正文全文）
-- ============================================================
CREATE TABLE IF NOT EXISTS operations (
    id          TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id   TEXT NOT NULL,
    action      TEXT NOT NULL,
    before_json TEXT,
    after_json  TEXT,
    diff_ref    TEXT,
    batch_id    TEXT,
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ops_entity  ON operations(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_ops_batch   ON operations(batch_id);
CREATE INDEX IF NOT EXISTS idx_ops_created ON operations(created_at);

-- ============================================================
-- 6.10 正文版本表：
-- ============================================================
CREATE TABLE IF NOT EXISTS content_revisions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id    TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    revision   INTEGER NOT NULL,
    content    TEXT,
    is_diff    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE (node_id, revision)
);
CREATE INDEX IF NOT EXISTS idx_rev_node ON content_revisions(node_id);

-- ============================================================
-- 6.11 子节点跟随覆盖表（阶段 2）
-- ============================================================
CREATE TABLE IF NOT EXISTS node_follow_overrides (
    node_id    TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    parent_id  TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    mode       TEXT NOT NULL DEFAULT 'default'
               CHECK (mode IN ('default','follow','never','delayed','independent')),
    start_date TEXT,
    end_date   TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (node_id, parent_id)
);
CREATE INDEX IF NOT EXISTS idx_follow_node ON node_follow_overrides(node_id);

-- ============================================================
-- 6.6 每日快照表（阶段 2）
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_snapshots (
    date          TEXT PRIMARY KEY,
    snapshot_json TEXT NOT NULL,
    created_at    TEXT NOT NULL
);

-- ============================================================
-- 6.9 节点版本表（可选，阶段 2）
-- ============================================================
CREATE TABLE IF NOT EXISTS node_versions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id    TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    version    INTEGER NOT NULL,
    title      TEXT,
    content    TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (node_id, version)
);
"#;

/// v2（阶段 2）：
/// - 当日覆盖增加「临时可见」标记（需求 4.4.4：指向时让目标节点当天可见，不生成出现段）
const V2_STAGE2: &str = r#"
ALTER TABLE day_overlays ADD COLUMN force_visible INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_ops_created_desc ON operations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_snap_created ON daily_snapshots(created_at DESC);
"#;

pub const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "init_core",
        sql: V1_INIT,
    },
    Migration {
        version: 2,
        name: "stage2_overlay_force_visible",
        sql: V2_STAGE2,
    },
];

/// 当前代码期望的最新 schema 版本
pub fn latest_version() -> i64 {
    MIGRATIONS.iter().map(|m| m.version).max().unwrap_or(0)
}

/// 已应用的 schema 版本（库不存在时为 0）
pub fn applied_version(conn: &Connection) -> AppResult<i64> {
    ensure_migrations_table(conn)?;
    let v: Option<i64> = conn
        .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
            row.get(0)
        })
        .unwrap_or(None);
    Ok(v.unwrap_or(0))
}

/// 待执行的迁移版本号
pub fn pending_versions(conn: &Connection) -> AppResult<Vec<i64>> {
    let applied = applied_version(conn)?;
    Ok(MIGRATIONS
        .iter()
        .filter(|m| m.version > applied)
        .map(|m| m.version)
        .collect())
}

fn ensure_migrations_table(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version    INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        );",
    )?;
    Ok(())
}

/// 顺序执行所有未应用的迁移，返回本次应用的版本号。
pub fn run(conn: &mut Connection) -> AppResult<Vec<i64>> {
    ensure_migrations_table(conn)?;
    let applied = applied_version(conn)?;
    let mut done = Vec::new();

    for migration in MIGRATIONS.iter().filter(|m| m.version > applied) {
        let tx = conn.transaction()?;
        tx.execute_batch(migration.sql).map_err(|e| {
            AppError::runtime(format!(
                "迁移 v{} ({}) 执行失败：{e}",
                migration.version, migration.name
            ))
        })?;
        tx.execute(
            "INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
            rusqlite::params![migration.version, crate::util::now_iso()],
        )?;
        tx.commit()?;
        tracing::info!(
            "已应用迁移 v{} ({})",
            migration.version,
            migration.name
        );
        done.push(migration.version);
    }

    Ok(done)
}
