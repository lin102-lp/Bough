//! 通用工具：日期、ID、时间戳。
//!
//! 约定（见需求文档 6. 数据模型）：
//! - 日期统一 `YYYY-MM-DD`（字典序 == 时间序，可直接用于 SQL 比较）
//! - 时间戳统一 ISO 8601（本地时区，带偏移量）

use crate::error::{AppError, AppResult};
use chrono::{Duration, Local, NaiveDate, SecondsFormat};

pub const DATE_FMT: &str = "%Y-%m-%d";

/// 当前时间：`2026-10-13T20:11:03+08:00`
pub fn now_iso() -> String {
    Local::now().to_rfc3339_opts(SecondsFormat::Secs, false)
}

/// 今天：`2026-10-13`
pub fn today_str() -> String {
    Local::now().format(DATE_FMT).to_string()
}

pub fn parse_date(s: &str) -> AppResult<NaiveDate> {
    NaiveDate::parse_from_str(s.trim(), DATE_FMT).map_err(|_| {
        AppError::invalid(format!("日期格式非法（应为 YYYY-MM-DD）：{s}"))
    })
}

pub fn format_date(d: NaiveDate) -> String {
    d.format(DATE_FMT).to_string()
}

/// 校验日期并返回规范形式（去掉首尾空格）。
pub fn ensure_date(s: &str) -> AppResult<String> {
    parse_date(s).map(format_date)
}

/// 日期偏移：`shift_days("2026-10-13", 1)` → `2026-10-14`
pub fn shift_days(date: &str, days: i64) -> AppResult<String> {
    Ok(format_date(parse_date(date)? + Duration::days(days)))
}

pub fn prev_day(date: &str) -> AppResult<String> {
    shift_days(date, -1)
}

pub fn next_day(date: &str) -> AppResult<String> {
    shift_days(date, 1)
}

/// `b - a` 的天数差
pub fn diff_days(a: &str, b: &str) -> AppResult<i64> {
    let (da, db) = (parse_date(a)?, parse_date(b)?);
    Ok((db - da).num_days())
}

/// `a <= b`
pub fn date_le(a: &str, b: &str) -> bool {
    a <= b
}

pub fn date_lt(a: &str, b: &str) -> bool {
    a < b
}

/// 带前缀的全局唯一 ID：`node_9f1c...`
pub fn new_id(prefix: &str) -> String {
    format!("{}_{}", prefix, uuid::Uuid::new_v4().simple())
}

/// 从 ISO 时间戳提取日期部分：`2026-10-13T20:11:03+08:00` → `2026-10-13`
pub fn iso_to_date(iso: &str) -> Option<String> {
    let s = iso.trim();
    if s.len() >= 10 && s.as_bytes().get(4) == Some(&b'-') {
        Some(s[..10].to_string())
    } else {
        None
    }
}

/// 截断到指定字符数（按字符而非字节，避免中文乱码）。
pub fn truncate_chars(s: &str, max: usize) -> String {
    let mut out = String::with_capacity(max.min(s.len()));
    for (i, c) in s.chars().enumerate() {
        if i >= max {
            out.push('…');
            break;
        }
        out.push(c);
    }
    out
}

/// 读取文件前 `max_bytes` 字节并转成字符串预览（UTF-8 边界安全）。
///
/// 文件可能被截断在多字节字符中间，这里从尾部逐字节回退直到是合法 UTF-8。
pub fn read_head(path: &std::path::Path, max_bytes: usize) -> std::io::Result<String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path)?;
    let mut buf = vec![0u8; max_bytes];
    let n = file.read(&mut buf)?;
    buf.truncate(n);
    let mut end = buf.len();
    while end > 0 {
        if let Ok(s) = std::str::from_utf8(&buf[..end]) {
            return Ok(s.to_string());
        }
        end -= 1;
    }
    Ok(String::new())
}
