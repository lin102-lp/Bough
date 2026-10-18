//! 应用状态：数据目录、SQLite 连接（单连接 + 互斥，桌面单用户场景足够且避免锁竞争）。

use crate::db;
use crate::error::{AppError, AppResult};
use crate::repo;
use parking_lot::{Mutex, MutexGuard};
use rusqlite::Connection;
use std::path::PathBuf;

pub struct AppState {
    pub conn: Mutex<Connection>,
    pub data_dir: PathBuf,
    pub db_path: PathBuf,
    pub notes_dir: PathBuf,
    pub overlays_dir: PathBuf,
    pub backups_dir: PathBuf,
    pub schema_version: i64,
}

impl AppState {
    /// 启动流程：
    /// 1. 建目录
    /// 2. 打开数据库（设置 PRAGMA）
    /// 3. 有待执行迁移 → 自动备份
    /// 4. 执行迁移
    /// 5. 写入默认设置
    pub fn bootstrap(data_dir: PathBuf) -> AppResult<Self> {
        let db_path = data_dir.join("notes.db");
        let notes_dir = data_dir.join("notes");
        let overlays_dir = data_dir.join("overlays");
        let backups_dir = data_dir.join("backups");
        let search_dir = data_dir.join("search-index");

        for dir in [&data_dir, &notes_dir, &overlays_dir, &backups_dir, &search_dir] {
            std::fs::create_dir_all(dir)
                .map_err(|e| AppError::runtime(format!("创建目录 {} 失败：{e}", dir.display())))?;
        }

        let mut conn = db::open(&db_path)?;

        let applied = db::migrations::applied_version(&conn)?;
        let pending = db::migrations::pending_versions(&conn)?;
        if !pending.is_empty() {
            if applied > 0 {
                let stamp = crate::util::now_iso().replace(':', "-");
                let target = backups_dir.join(format!("pre-migration-v{applied}-{stamp}.db"));
                match db::backup_to(&conn, &target) {
                    Ok(size) => tracing::info!("迁移前备份完成：{}（{size} 字节）", target.display()),
                    Err(e) => tracing::warn!("迁移前备份失败（继续迁移）：{e}"),
                }
            }
            let done = db::migrations::run(&mut conn)?;
            tracing::info!("已应用迁移版本：{done:?}");
        }

        repo::settings::seed_defaults(&conn, &crate::util::now_iso())?;
        let schema_version = db::migrations::applied_version(&conn)?;

        Ok(Self {
            conn: Mutex::new(conn),
            data_dir,
            db_path,
            notes_dir,
            overlays_dir,
            backups_dir,
            schema_version,
        })
    }

    pub fn lock(&self) -> MutexGuard<'_, Connection> {
        self.conn.lock()
    }

    /// 事务辅助：把闭包放在一个事务里执行。
    pub fn with_tx<T>(&self, f: impl FnOnce(&rusqlite::Transaction<'_>) -> AppResult<T>) -> AppResult<T> {
        let mut guard = self.lock();
        let tx = guard.transaction()?;
        let out = f(&tx)?;
        tx.commit()?;
        Ok(out)
    }
}
