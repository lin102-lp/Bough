//! 统一错误类型：所有命令返回 `AppResult<T>`，错误以字符串形式序列化给前端。

use serde::{Serialize, Serializer};

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("数据库错误：{0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("文件读写错误：{0}")]
    Io(#[from] std::io::Error),

    #[error("JSON 序列化错误：{0}")]
    Json(#[from] serde_json::Error),

    #[error("运行时错误：{0}")]
    Runtime(String),

    #[error("未找到：{0}")]
    NotFound(String),

    #[error("参数非法：{0}")]
    Invalid(String),

    #[error("冲突：{0}")]
    Conflict(String),
}

impl AppError {
    pub fn invalid(msg: impl Into<String>) -> Self {
        AppError::Invalid(msg.into())
    }

    pub fn not_found(msg: impl Into<String>) -> Self {
        AppError::NotFound(msg.into())
    }

    pub fn conflict(msg: impl Into<String>) -> Self {
        AppError::Conflict(msg.into())
    }

    pub fn runtime(msg: impl Into<String>) -> Self {
        AppError::Runtime(msg.into())
    }

    /// 把 SQLite 的唯一约束错误翻译成更友好的中文提示。
    pub fn from_sqlite(err: rusqlite::Error, context: &str) -> Self {
        if let rusqlite::Error::SqliteFailure(e, ref msg) = err {
            // 19 = SQLITE_CONSTRAINT
            if e.code == rusqlite::ErrorCode::ConstraintViolation {
                let detail = msg.clone().unwrap_or_default();
                return AppError::Conflict(format!("{context}（{detail}）"));
            }
        }
        AppError::Sqlite(err)
    }

    /// 前端展示用的错误码，便于按类型做 UI 处理。
    pub fn code(&self) -> &'static str {
        match self {
            AppError::Sqlite(_) => "sqlite",
            AppError::Io(_) => "io",
            AppError::Json(_) => "json",
            AppError::Runtime(_) => "runtime",
            AppError::NotFound(_) => "not_found",
            AppError::Invalid(_) => "invalid",
            AppError::Conflict(_) => "conflict",
        }
    }
}

impl From<tauri::Error> for AppError {
    fn from(value: tauri::Error) -> Self {
        AppError::Runtime(value.to_string())
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        // 前端 invoke 的 reject 值：`[code] 人类可读消息`
        serializer.serialize_str(&format!("[{}] {}", self.code(), self))
    }
}
