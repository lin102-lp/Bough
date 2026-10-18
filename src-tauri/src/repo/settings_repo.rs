//! 设置表访问。

use crate::error::AppResult;
use crate::models::{SettingsMap, VisibilityOptions};
use rusqlite::{params, Connection};

/// 设置键名常量（前后端共用，避免拼写错误）
pub mod keys {
    pub const DEFAULT_CONTINUATION: &str = "default_continuation";
    pub const DEFAULT_EDIT_MODE: &str = "default_edit_mode";
    pub const THEME: &str = "theme";
    pub const WEEK_START: &str = "week_start";
    /// 自动延续动态可见（阶段 1 可关闭，退化为「只有出现段起始日可见」）
    pub const VISIBILITY_AUTO_CONTINUATION: &str = "visibility.auto_continuation";
    /// 子节点跟随（阶段 2 开启）
    pub const VISIBILITY_PARENT_FOLLOW: &str = "visibility.parent_follow";
    /// 默认显示隐藏节点
    pub const SHOW_HIDDEN: &str = "ui.show_hidden";
    /// 自动布局间距
    pub const LAYOUT_X_GAP: &str = "layout.x_gap";
    pub const LAYOUT_Y_GAP: &str = "layout.y_gap";
}

pub fn all(conn: &Connection) -> AppResult<SettingsMap> {
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut map = SettingsMap::new();
    for r in rows {
        let (k, v) = r?;
        map.insert(k, v);
    }
    Ok(map)
}

pub fn get(conn: &Connection, key: &str) -> AppResult<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
    let mut rows = stmt.query_map(params![key], |row| row.get::<_, String>(0))?;
    match rows.next() {
        Some(r) => Ok(Some(r?)),
        None => Ok(None),
    }
}

pub fn set(conn: &Connection, key: &str, value: &str, now: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, value, now],
    )?;
    Ok(())
}

pub fn get_bool(conn: &Connection, key: &str, default: bool) -> bool {
    match get(conn, key) {
        Ok(Some(v)) => matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"),
        _ => default,
    }
}

pub fn get_i64(conn: &Connection, key: &str, default: i64) -> i64 {
    match get(conn, key) {
        Ok(Some(v)) => v.trim().parse::<i64>().unwrap_or(default),
        _ => default,
    }
}

/// 首次运行时写入默认设置。
pub fn seed_defaults(conn: &Connection, now: &str) -> AppResult<()> {
    let defaults: [(&str, &str); 9] = [
        (keys::DEFAULT_CONTINUATION, "auto"),
        (keys::DEFAULT_EDIT_MODE, "day_overlay"),
        (keys::THEME, "system"),
        (keys::WEEK_START, "1"),
        (keys::VISIBILITY_AUTO_CONTINUATION, "1"),
        (keys::VISIBILITY_PARENT_FOLLOW, "0"),
        (keys::SHOW_HIDDEN, "0"),
        (keys::LAYOUT_X_GAP, "300"),
        (keys::LAYOUT_Y_GAP, "160"),
    ];
    for (k, v) in defaults {
        conn.execute(
            "INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)",
            params![k, v, now],
        )?;
    }
    Ok(())
}

/// 从设置表读取可见性引擎开关。
pub fn visibility_options(conn: &Connection) -> VisibilityOptions {
    VisibilityOptions {
        auto_continuation: get_bool(conn, keys::VISIBILITY_AUTO_CONTINUATION, true),
        parent_follow: get_bool(conn, keys::VISIBILITY_PARENT_FOLLOW, false),
    }
}
