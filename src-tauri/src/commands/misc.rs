//! 杂项命令：应用信息、设置、备份。

use crate::db;
use crate::error::{AppError, AppResult};
use crate::models::{AppInfo, BackupInfo, SettingsMap};
use crate::repo;
use crate::state::AppState;
use crate::util;
use std::path::Path;
use tauri::State;

#[tauri::command(async)]
pub fn ping() -> String {
    format!("pong @ {}", util::now_iso())
}

#[tauri::command(async)]
pub fn get_app_info(state: State<'_, AppState>) -> AppResult<AppInfo> {
    Ok(AppInfo {
        name: "树状时间笔记 TimeTree".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        data_dir: state.data_dir.display().to_string(),
        db_path: state.db_path.display().to_string(),
        notes_dir: state.notes_dir.display().to_string(),
        overlays_dir: state.overlays_dir.display().to_string(),
        backups_dir: state.backups_dir.display().to_string(),
        schema_version: state.schema_version,
        today: util::today_str(),
    })
}

#[tauri::command(async)]
pub fn get_settings(state: State<'_, AppState>) -> AppResult<SettingsMap> {
    let conn = state.lock();
    repo::settings::all(&conn)
}

#[tauri::command(async)]
pub fn set_setting(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> AppResult<SettingsMap> {
    let conn = state.lock();
    repo::settings::set(&conn, key.trim(), &value, &util::now_iso())?;
    repo::settings::all(&conn)
}

fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let target = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

/// 创建一份完整备份：数据库（在线备份 API）+ notes / overlays 目录。
#[tauri::command(async)]
pub fn create_backup(state: State<'_, AppState>, label: Option<String>) -> AppResult<BackupInfo> {
    let stamp = util::now_iso().replace(':', "-");
    let name = match label.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(l) => format!("{stamp}-{}", l.replace(['/', '\\', ' '], "_")),
        None => stamp.clone(),
    };
    let target_dir = state.backups_dir.join(&name);
    std::fs::create_dir_all(&target_dir)?;

    let db_target = target_dir.join("notes.db");
    {
        let conn = state.lock();
        db::backup_to(&conn, &db_target)?;
    }

    copy_dir_all(&state.notes_dir, &target_dir.join("notes"))?;
    if state.overlays_dir.exists() {
        copy_dir_all(&state.overlays_dir, &target_dir.join("overlays"))?;
    }

    let size = dir_size(&target_dir).unwrap_or(0);
    Ok(BackupInfo {
        path: target_dir.display().to_string(),
        created_at: util::now_iso(),
        size_bytes: size,
    })
}

fn dir_size(path: &Path) -> std::io::Result<u64> {
    let mut total = 0u64;
    if path.is_file() {
        return Ok(std::fs::metadata(path)?.len());
    }
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        if ty.is_dir() {
            total += dir_size(&entry.path())?;
        } else {
            total += entry.metadata()?.len();
        }
    }
    Ok(total)
}

/// 列出已有备份目录。
#[tauri::command(async)]
pub fn list_backups(state: State<'_, AppState>) -> AppResult<Vec<BackupInfo>> {
    let mut out = Vec::new();
    if !state.backups_dir.exists() {
        return Ok(out);
    }
    for entry in std::fs::read_dir(&state.backups_dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let path = entry.path();
        let created_at = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .map(|t| chrono::DateTime::<chrono::Local>::from(t).to_rfc3339())
            .unwrap_or_default();
        out.push(BackupInfo {
            size_bytes: dir_size(&path).unwrap_or(0),
            path: path.display().to_string(),
            created_at,
        });
    }
    out.sort_by(|a, b| b.path.cmp(&a.path));
    Ok(out)
}

/// 校验数据目录可写（前端启动自检用）。
#[tauri::command(async)]
pub fn check_data_dir(state: State<'_, AppState>) -> AppResult<bool> {
    let probe = state.data_dir.join(".write-test");
    std::fs::write(&probe, b"ok")
        .map_err(|e| AppError::runtime(format!("数据目录不可写：{e}")))?;
    let _ = std::fs::remove_file(&probe);
    Ok(true)
}
