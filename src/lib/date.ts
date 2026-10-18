/** 日期工具：全局统一 `YYYY-MM-DD` 字符串进出，UI 里用 dayjs 格式化。 */

import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import isoWeek from "dayjs/plugin/isoWeek";
import weekday from "dayjs/plugin/weekday";

dayjs.extend(isoWeek);
dayjs.extend(weekday);
dayjs.locale("zh-cn");

export const DATE_FORMAT = "YYYY-MM-DD";
export const WEEKDAYS_CN = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export function today(): string {
  return dayjs().format(DATE_FORMAT);
}

export function isValidDate(value: string): boolean {
  return dayjs(value, DATE_FORMAT, true).isValid();
}

export function shiftDate(date: string, days: number): string {
  return dayjs(date).add(days, "day").format(DATE_FORMAT);
}

export const prevDate = (date: string) => shiftDate(date, -1);
export const nextDate = (date: string) => shiftDate(date, 1);

/** 与今天相差的天数（今天 = 0，昨天 = -1） */
export function daysFromToday(date: string): number {
  return dayjs(date).diff(dayjs(today()), "day");
}

export function isToday(date: string): boolean {
  return date === today();
}

export function isWeekend(date: string): boolean {
  const d = dayjs(date).day();
  return d === 0 || d === 6;
}

/** `2026-10-13` → `2026 年 10 月 13 日 周二` */
export function formatFull(date: string): string {
  return dayjs(date).format("YYYY 年 M 月 D 日 dddd");
}

/** `2026-10-13` → `10/13 周二` */
export function formatShort(date: string): string {
  return dayjs(date).format("M/D dddd");
}

/** `2026-10-13` → `10-13` */
export function formatMd(date: string): string {
  return dayjs(date).format("MM-DD");
}

/** 相对今天的自然语言描述 */
export function relativeLabel(date: string): string {
  const diff = daysFromToday(date);
  if (diff === 0) return "今天";
  if (diff === -1) return "昨天";
  if (diff === 1) return "明天";
  if (diff === -2) return "前天";
  if (diff === 2) return "后天";
  if (diff < 0) return `${Math.abs(diff)} 天前`;
  return `${diff} 天后`;
}

/** ISO 时间戳 → `YYYY-MM-DD HH:mm` */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = dayjs(iso);
  return d.isValid() ? d.format("YYYY-MM-DD HH:mm") : iso;
}

/** 时间戳里的日期部分 */
export function isoDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = dayjs(iso);
  return d.isValid() ? d.format(DATE_FORMAT) : null;
}

/** 该日期所在周的周一 */
export function startOfWeek(date: string): string {
  return dayjs(date).startOf("isoWeek").format(DATE_FORMAT);
}

/** 生成 [from, to] 闭区间内的所有日期（含端点），最多 limit 天 */
export function dateRange(from: string, to: string, limit = 60): string[] {
  const out: string[] = [];
  let cursor = from;
  const end = to;
  let guard = 0;
  while (cursor <= end && guard < limit) {
    out.push(cursor);
    cursor = nextDate(cursor);
    guard += 1;
  }
  return out;
}
