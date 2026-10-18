//! Tauri 命令层：参数校验 + 业务编排，SQL 一律下沉到 `repo`。
//!
//! 所有命令都标注 `#[tauri::command(async)]`，让它们在独立线程池执行，
//! 不阻塞 UI 主线程（rusqlite 是同步阻塞 API）。

pub mod audit;
pub mod day_view;
pub mod edge;
pub mod follow;
pub mod history;
pub mod layout;
pub mod misc;
pub mod node;
pub mod occurrence;
pub mod overlay;
pub mod time_tree;
