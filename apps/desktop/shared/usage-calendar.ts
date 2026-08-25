/**
 * [INPUT]: Depends on the standard Intl.DateTimeFormat and the ability to build UTC calendar
 * [OUTPUT]: Provides time zone to dayKey, calendar to addDays, 53 weeks heatmap matrix to start on Sunday with monthSpans
 * [POS]: The core of the shared calendar is pure calendar; main polymer and renderer heat stroke share same daytime quality
 */

const DAY_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export type HeatmapCell = {
  dayKey: string;
  future: boolean;
};

export type HeatmapCalendar = {
  rows: HeatmapCell[][];
  monthLabels: Array<string | null>;
};

export type MonthSpan = {
  label: string;
  column: number;
  span: number;
};

type DateParts = { year: number; month: number; day: number };

function parseDayKey(value: string): DateParts {
  const match = DAY_KEY_PATTERN.exec(value);
  if (!match) throw new Error(`日期键格式无效: ${value}`);
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (
    date.getUTCFullYear() !== parts.year ||
    date.getUTCMonth() !== parts.month - 1 ||
    date.getUTCDate() !== parts.day
  ) {
    throw new Error(`日期键不存在: ${value}`);
  }
  return parts;
}

function fromUtcDate(date: Date) {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/* ============================================================
 * Intl.DateTimeFormat 的构造是 V8 上最贵的操作之一（实测 36µs），
 * 而 dayKey 在合并阶段每个 usage 事件调用一次——30 万事件就是
 * 11 秒同步独占主进程，Electron 主进程在这期间完全不处理事件
 * 循环，系统于是给出忙碌光标。
 *
 * 格式化器只与时区有关，按时区记忆即可：实测 36µs → 1.5µs。
 * 非法时区仍在首次构造时抛出，行为不变。
 * ============================================================ */

const dayKeyFormatters = new Map<string, Intl.DateTimeFormat>();

function dayKeyFormatter(timeZone: string) {
  const cached = dayKeyFormatters.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat("en-CA-u-ca-gregory", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  dayKeyFormatters.set(timeZone, created);
  return created;
}

export function dayKey(epochMs: number, timeZone: string) {
  if (!Number.isFinite(epochMs)) throw new Error("时间戳无效");
  const parts = dayKeyFormatter(timeZone).formatToParts(new Date(epochMs));
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const year = read("year");
  const month = read("month");
  const day = read("day");
  if (!year || !month || !day) throw new Error("无法生成本地日期键");
  return `${year}-${month}-${day}`;
}

export function addDays(value: string, amount: number) {
  if (!Number.isInteger(amount)) throw new Error("日历步长必须是整数");
  const { year, month, day } = parseDayKey(value);
  return fromUtcDate(new Date(Date.UTC(year, month - 1, day + amount)));
}

function weekDay(value: string) {
  const { year, month, day } = parseDayKey(value);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function monthLabel(value: string) {
  return MONTH_LABELS[parseDayKey(value).month - 1];
}

export function heatmapMatrix(todayKey: string): HeatmapCalendar {
  parseDayKey(todayKey);
  const start = addDays(todayKey, -weekDay(todayKey) - 52 * 7);
  const rows = Array.from({ length: 7 }, (_, row) =>
    Array.from({ length: 53 }, (_, column) => {
      const value = addDays(start, column * 7 + row);
      return { dayKey: value, future: value > todayKey };
    })
  );
  const monthLabels = Array.from({ length: 53 }, (_, column) => {
    const firstOfMonth = rows
      .map((row) => row[column])
      .find((cell) => !cell.future && cell.dayKey.endsWith("-01"));
    if (firstOfMonth) return monthLabel(firstOfMonth.dayKey);
    return column === 0 ? monthLabel(rows[0][0].dayKey) : null;
  });
  return { rows, monthLabels };
}

/* ============================================================
 * 把「每列一个可空标签」折叠成「每月一段连续列」。
 * 标签从此拥有真实宽度，渲染层不再靠溢出碰运气对齐。
 * ============================================================ */

export function monthSpans(monthLabels: Array<string | null>): MonthSpan[] {
  const spans: MonthSpan[] = [];
  monthLabels.forEach((label, column) => {
    const previous = spans[spans.length - 1];
    if (label === null) {
      if (previous) previous.span += 1;
      return;
    }
    spans.push({ label, column, span: 1 });
  });
  return spans;
}
