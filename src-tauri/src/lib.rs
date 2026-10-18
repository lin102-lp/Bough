//! 树状时间笔记 TimeTree —— Rust 后端入口
//!
//! 分层结构：
//! ```text
//! commands/   对前端暴露的 Tauri 命令（参数校验 + 编排）
//! visibility  可见性状态机（纯函数式判定引擎）
//! repo/       数据访问层（SQL 全部集中在这里）
//! db/         连接、PRAGMA、迁移
//! models      与前端 TypeScript 类型一一对应的数据结构
//! ```

pub mod commands;
pub mod content;
pub mod db;
pub mod error;
pub mod models;
pub mod models_stage2;
pub mod repo;
pub mod state;
pub mod util;
pub mod visibility;

pub use error::{AppError, AppResult};

use state::AppState;
use tauri::Manager;

/// 数据目录解析：优先环境变量 `TIMETREE_DATA_DIR`（便于开发/测试隔离），
/// 否则使用系统标准的应用数据目录。
fn resolve_data_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, AppError> {
    if let Ok(custom) = std::env::var("TIMETREE_DATA_DIR") {
        if !custom.trim().is_empty() {
            return Ok(std::path::PathBuf::from(custom));
        }
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Invalid(format!("无法获取应用数据目录: {e}")))?;
    Ok(dir.join("timetree"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 日志：RUST_LOG=debug 可打开调试日志
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,timetree_lib=debug")),
        )
        .with_target(false)
        .try_init();

    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            let data_dir = resolve_data_dir(&handle)?;
            let state = AppState::bootstrap(data_dir)?;
            tracing::info!("TimeTree 数据目录: {}", state.data_dir.display());
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // 基础 / 设置
            commands::misc::ping,
            commands::misc::get_app_info,
            commands::misc::get_settings,
            commands::misc::set_setting,
            commands::misc::create_backup,
            commands::misc::list_backups,
            commands::misc::check_data_dir,
            // 日期视图
            commands::day_view::get_day_view,
            // 节点
            commands::node::list_nodes,
            commands::node::get_node,
            commands::node::search_nodes,
            commands::node::save_node,
            commands::node::delete_node,
            commands::node::restore_node,
            commands::node::purge_node,
            commands::node::set_node_status,
            commands::node::get_node_content,
            commands::node::save_node_content,
            commands::node::get_node_previews,
            // 出现段
            commands::occurrence::list_occurrences,
            commands::occurrence::add_occurrence,
            commands::occurrence::update_occurrence,
            commands::occurrence::delete_occurrence,
            commands::occurrence::continue_node_to_next_day,
            commands::occurrence::reappear_node,
            // 当日覆盖
            commands::overlay::get_day_overlay,
            commands::overlay::save_day_overlay,
            commands::overlay::clear_day_overlay,
            commands::overlay::set_day_force_visible,
            // 当天边
            commands::edge::list_day_edges,
            commands::edge::create_edge,
            commands::edge::update_edge,
            commands::edge::delete_edge,
            commands::edge::delete_edges,
            commands::edge::delete_edge_batch,
            commands::edge::restore_edge,
            commands::edge::restore_edge_batch,
            commands::edge::purge_edge,
            commands::edge::copy_edges_to_next_day,
            // 布局
            commands::layout::get_day_layouts,
            commands::layout::save_day_layouts,
            commands::layout::reset_day_layouts,
            // 时间树
            commands::time_tree::get_node_time_tree,
            // 阶段 2：子节点跟随覆盖
            commands::follow::list_follow_overrides,
            commands::follow::set_follow_override,
            commands::follow::delete_follow_override,
            // 阶段 2：操作记录 / 每日快照
            commands::history::list_operations,
            commands::history::list_snapshots,
            commands::history::create_snapshot,
            commands::history::ensure_daily_snapshot,
            commands::history::delete_snapshot,
            commands::history::restore_snapshot,
        ])
        .run(tauri::generate_context!())
        .expect("TimeTree 启动失败");
}
