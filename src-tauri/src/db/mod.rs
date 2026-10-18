//! 数据库连接与迁移入口。

pub mod migrations;

use crate::error::AppResult;
use rusqlite::Connection;
use std::path::Path;

/// 打开（或创建）数据库，并设置连接级 PRAGMA。
///
/// 注意：`foreign_keys` 是连接级开关，每次建立连接都必须打开（需求 4.6）。
pub fn open(db_path: &Path) -> AppResult<Connection> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(db_path)?;
    configure(&conn)?;
    Ok(conn)
}

pub fn configure(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;
         PRAGMA temp_store = MEMORY;
         PRAGMA recursive_triggers = ON;",
    )?;
    Ok(())
}

/// 迁移前备份（需求 4.6：迁移前自动备份）。
///
/// 使用 SQLite 的在线备份 API，保证 WAL 中的内容也会被写入备份文件。
pub fn backup_to(conn: &Connection, target: &Path) -> AppResult<u64> {
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut dst = Connection::open(target)?;
    let backup = rusqlite::backup::Backup::new(conn, &mut dst)?;
    backup.run_to_completion(64, std::time::Duration::from_millis(5), None)?;
    drop(backup);
    drop(dst);
    Ok(std::fs::metadata(target).map(|m| m.len()).unwrap_or(0))
}
