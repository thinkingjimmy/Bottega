/**
 * [INPUT]: Depends on React, i18n, shared calendar/token/cost calendar, use-client allocation/date/USD formatting with three-dimensional costText, renderer Intl locale, projecting the same directory color stages USAGE_RAMP_BG, ui Tooltip
 * [OUTPUT]: Provides a 7×53 UsageHeatmap with a portable UsageHeatmapLegend; Color stages are based on the shared ramp, tooltip and the same set of three-dimensional charges shared by the indicator zone
 * [POS]: Visualization of the settings/usage sub-module, located in the middle of the card; The title and illustrations are reversed, todayKey/timeZone and price facts are inserted by Summary
 */

import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { heatmapMatrix, monthSpans } from "../../../../shared/usage-calendar";
import type { DailyTokens } from "../../../../shared/usage-ipc";
import {
  costText,
  formatCompactTokens,
  formatDayKey,
  formatUsd,
  usageLevel,
  usageThresholds,
} from "@/lib/usage-client";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@ai-chat/ui/components/ui/tooltip";
import { cn } from "@ai-chat/ui/lib/utils";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { intlLocale } from "@/lib/i18n-locale";
import { USAGE_RAMP_BG } from "@/components/settings/usage/usage-ramp";

const ENGLISH_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;
/* 一个月不足 3 列时文字必然被截断，宁可留白也不显示半个月份名 */
const MIN_MONTH_LABEL_SPAN = 3;

function key(row: number, column: number) {
  return `${row}:${column}`;
}

function lastUsableColumn(row: Array<{ future: boolean }>) {
  for (let index = row.length - 1; index >= 0; index -= 1) {
    if (!row[index].future) return index;
  }
  return 0;
}

function todayPosition(
  rows: Array<Array<{ dayKey: string }>>,
  todayKey: string
) {
  for (let row = 0; row < rows.length; row += 1) {
    const column = rows[row].findIndex((cell) => cell.dayKey === todayKey);
    if (column >= 0) return { row, column };
  }
  return { row: 0, column: 0 };
}

export function UsageHeatmap({
  daily,
  dailyCostUsd,
  dailyUnpricedTokens,
  todayKey,
  timeZone,
}: {
  daily: DailyTokens;
  dailyCostUsd: Record<string, number>;
  dailyUnpricedTokens: Record<string, number>;
  todayKey: string;
  timeZone: string;
}) {
  const { t } = useAppTranslation();
  const calendar = useMemo(() => heatmapMatrix(todayKey), [todayKey]);
  const months = useMemo(
    () => monthSpans(calendar.monthLabels),
    [calendar.monthLabels]
  );
  const thresholds = useMemo(() => usageThresholds(daily), [daily]);
  const locale = intlLocale();
  const dayNames = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, {
      timeZone: "UTC",
      weekday: "short",
    });
    return Array.from({ length: 7 }, (_, day) =>
      formatter.format(new Date(Date.UTC(2026, 7, 16 + day)))
    );
  }, [locale]);
  const localizedMonths = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, {
      timeZone: "UTC",
      month: "short",
    });
    return Object.fromEntries(
      ENGLISH_MONTHS.map((month, index) => [
        month,
        formatter.format(new Date(Date.UTC(2026, index, 1))),
      ])
    );
  }, [locale]);
  const [focused, setFocused] = useState(() =>
    todayPosition(calendar.rows, todayKey)
  );
  const scrollerRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef(new Map<string, HTMLButtonElement>());

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller) scroller.scrollLeft = scroller.scrollWidth;
  }, [todayKey]);

  const moveFocus = (
    event: KeyboardEvent<HTMLButtonElement>,
    row: number,
    column: number
  ) => {
    let nextRow = row;
    let nextColumn = column;
    if (event.key === "ArrowLeft") nextColumn -= 1;
    else if (event.key === "ArrowRight") nextColumn += 1;
    else if (event.key === "ArrowUp") nextRow -= 1;
    else if (event.key === "ArrowDown") nextRow += 1;
    else if (event.key === "Home") nextColumn = 0;
    else if (event.key === "End") {
      nextColumn = lastUsableColumn(calendar.rows[row]);
    } else {
      return;
    }
    event.preventDefault();
    const next = calendar.rows[nextRow]?.[nextColumn];
    if (!next || next.future) return;
    setFocused({ row: nextRow, column: nextColumn });
    cellRefs.current.get(key(nextRow, nextColumn))?.focus();
  };

  return (
    <div>
      <p className="sr-only">
        {t("settings.usage.dailyTotals", { timeZone })}
      </p>

      {/* ========================================================
       * 一个 54 列外层网格 + 两级 subgrid：星期表头、格子、月份
       * 共享同一组轨道，对齐是结构保证的，不靠任何魔法偏移量。
       * 列宽 minmax(0,1fr) 让格子随面板呼吸，窄到极限才横向滚动。
       * ======================================================== */}
      <div ref={scrollerRef} className="overflow-x-auto pb-1">
        <div className="grid min-w-[45rem] gap-x-[3px] [grid-template-columns:auto_repeat(53,minmax(0,1fr))]">
          <div
            role="grid"
            aria-label={t("settings.usage.dailyGrid")}
            aria-rowcount={7}
            aria-colcount={54}
            className="col-span-full grid grid-cols-subgrid gap-[3px]"
          >
            {calendar.rows.map((row, rowIndex) => (
              <div
                key={dayNames[rowIndex]}
                role="row"
                aria-label={dayNames[rowIndex]}
                className="col-span-full grid grid-cols-subgrid"
              >
                <span
                  aria-hidden="true"
                  className="self-center pr-1.5 text-[10px] text-muted-foreground leading-none"
                >
                  {rowIndex % 2 === 1 ? dayNames[rowIndex] : ""}
                </span>
                {row.map((cell, columnIndex) => {
                  if (cell.future) {
                    return (
                      <span
                        key={cell.dayKey}
                        role="gridcell"
                        aria-hidden="true"
                        className="aspect-square w-full rounded-[3px]"
                      />
                    );
                  }
                  const tokens = daily[cell.dayKey] ?? 0;
                  const cost = costText(
                    dailyCostUsd[cell.dayKey] ?? 0,
                    tokens,
                    dailyUnpricedTokens[cell.dayKey] ?? 0,
                    formatUsd
                  );
                  const label = t("settings.usage.cellLabel", {
                    date: formatDayKey(cell.dayKey),
                    tokens: formatCompactTokens(tokens),
                    cost,
                  });
                  return (
                    <Tooltip key={cell.dayKey}>
                      <TooltipTrigger asChild>
                        <button
                          ref={(node) => {
                            const cellKey = key(rowIndex, columnIndex);
                            if (node) cellRefs.current.set(cellKey, node);
                            else cellRefs.current.delete(cellKey);
                          }}
                          type="button"
                          role="gridcell"
                          aria-label={label}
                          data-day={cell.dayKey}
                          data-level={usageLevel(tokens, thresholds)}
                          tabIndex={
                            focused.row === rowIndex &&
                            focused.column === columnIndex
                              ? 0
                              : -1
                          }
                          onFocus={() =>
                            setFocused({
                              row: rowIndex,
                              column: columnIndex,
                            })
                          }
                          onKeyDown={(event) =>
                            moveFocus(event, rowIndex, columnIndex)
                          }
                          className={cn(
                            "aspect-square w-full rounded-[3px] outline-none transition-[transform,box-shadow] hover:scale-125 focus-visible:z-10 focus-visible:scale-125 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                            USAGE_RAMP_BG[usageLevel(tokens, thresholds)]
                          )}
                        />
                      </TooltipTrigger>
                      <TooltipContent side="top">{label}</TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            ))}
          </div>

          <div
            aria-hidden="true"
            className="col-span-full mt-2 grid grid-cols-subgrid text-[11px] text-muted-foreground"
          >
            <span />
            {months.map((month) => (
              <span
                key={`${month.column}:${month.label}`}
                style={{ gridColumn: `span ${month.span}` }}
                className="truncate"
              >
                {month.span >= MIN_MONTH_LABEL_SPAN
                  ? (localizedMonths[month.label] ?? month.label)
                  : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * 图例从热力图里搬了出来：标题与强度尺各自归位到段头的 title 与
 * action 两个槽，于是页内段头与 SettingsSection 的段头长得一样，
 * 热力图自己也不必再画第二条标题栏。
 * ============================================================ */

export function UsageHeatmapLegend() {
  const { t } = useAppTranslation();
  return (
    <div
      aria-label={t("settings.usage.intensity")}
      className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground"
    >
      <span>{t("settings.usage.less")}</span>
      {USAGE_RAMP_BG.map((className, level) => (
        <span
          key={className}
          aria-label={t("settings.usage.level", { level })}
          className={cn("size-2.5 rounded-[2px]", className)}
        />
      ))}
      <span>{t("settings.usage.more")}</span>
    </div>
  );
}
