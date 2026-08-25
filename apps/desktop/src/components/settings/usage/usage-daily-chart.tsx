/**
 * [INPUT]: Depends on React useMemo, project the same directory color as USAGE_RAMP_FILL/USAGE_BAND_LEVELS, ui Tooltip and cn
 * [OUTPUT]: Provides UsageDailyChart The daily daily daily daily daily daily daily daily stacked area map of the SVG is hand-painted with the Tooltip marked today
 * [POS]: The following are the settings/usage sub-modules: Just draw the input values, don't know Summary, and don't touch ECharts
 */

import { useMemo } from "react";
import {
  USAGE_BAND_LEVELS,
  USAGE_RAMP_FILL,
} from "@/components/settings/usage/usage-ramp";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@ai-chat/ui/components/ui/tooltip";
import { cn } from "@ai-chat/ui/lib/utils";

export type UsageChartBand = {
  /** 稳定身份：明度按它取，不按当日大小排 */
  key: string;
  values: number[];
};

/* ============================================================
 * 为什么是手绘 SVG 而不是 ECharts。
 *
 * ECharts 被 check-renderer-bundle.mjs 钉在 LAZY_LANES 里——它不许进
 * 首包静态闭包，只能经 LazyChart 动态加载。为一条 30 点的折线拉一个
 * 异步重块，代价与收益不成比例；而这里要的东西 ECharts 也给不了得更好：
 * 三档明度的堆叠、与热力图共用的那条 ramp、贴着宿主 Tooltip 的逐日注解。
 *
 * 坐标系归一到 0..100 并 preserveAspectRatio="none"：宽度随面板呼吸，
 * 不必测量容器，也就没有 ResizeObserver 与首帧零宽那一类问题。描边一律
 * vector-effect="non-scaling-stroke"，于是横向拉伸不会把线拉粗。
 *
 * 会被非等比拉伸变形的东西（今日圆点、悬停竖线、刻度文字）一律不进
 * SVG，改用按百分比定位的 HTML 覆盖层——形状因此与宽度无关。
 * ============================================================ */

const VIEW = 100;

function niceCeil(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/* Catmull-Rom 转三次贝塞尔：逐日消费本就是连续量，折角是采样的产物
   而不是事实。张力固定 1/6，克制到不会造出数据里没有的峰。 */
function smooth(points: Array<[number, number]>) {
  if (points.length === 0) return "";
  const round = (value: number) => Math.round(value * 100) / 100;
  let path = `M${round(points[0][0])},${round(points[0][1])}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index];
    const start = points[index];
    const end = points[index + 1];
    const next = points[index + 2] ?? end;
    const c1 = [
      start[0] + (end[0] - previous[0]) / 6,
      start[1] + (end[1] - previous[1]) / 6,
    ];
    const c2 = [end[0] - (next[0] - start[0]) / 6, end[1] - (next[1] - start[1]) / 6];
    path += `C${round(c1[0])},${round(c1[1])} ${round(c2[0])},${round(c2[1])} ${round(end[0])},${round(end[1])}`;
  }
  return path;
}

function geometry(bands: UsageChartBand[], length: number) {
  const stacked: number[][] = [];
  let running = new Array(length).fill(0) as number[];
  for (const band of bands) {
    running = running.map((value, index) => value + Math.max(0, band.values[index] ?? 0));
    stacked.push([...running]);
  }
  const totals = stacked[stacked.length - 1] ?? new Array(length).fill(0);
  const axisMax = niceCeil(Math.max(...totals, 0) * 1.15);
  const x = (index: number) => (length <= 1 ? 0 : (index / (length - 1)) * VIEW);
  const y = (value: number) => VIEW - (value / axisMax) * VIEW;

  const areas = stacked.map((upper, index) => {
    const lower = index === 0 ? new Array(length).fill(0) : stacked[index - 1];
    const top = smooth(upper.map((value, day) => [x(day), y(value)]));
    const bottomPoints = lower
      .map((value, day) => [x(day), y(value)] as [number, number])
      .reverse();
    const bottom = smooth(bottomPoints).replace(/^M/, "L");
    return `${top}${bottom}Z`;
  });

  return {
    areas,
    outline: smooth(totals.map((value, day) => [x(day), y(value)])),
    totals,
    axisMax,
    lastRatio: axisMax > 0 ? (totals[length - 1] ?? 0) / axisMax : 0,
  };
}

export function UsageDailyChart({
  bands,
  days,
  label,
  axisLabels,
  formatAxis,
  gridAriaLabel,
}: {
  bands: UsageChartBand[];
  /** 逐日的键，只用来给列一个稳定 key */
  days: string[];
  /** 第 index 天的完整读法，同时用作 Tooltip 正文与列的可及名 */
  label: (index: number) => string;
  /** x 轴三个刻度：起、中、止 */
  axisLabels: [string, string, string];
  formatAxis: (value: number) => string;
  gridAriaLabel: string;
}) {
  const chart = useMemo(() => geometry(bands, days.length), [bands, days.length]);

  return (
    <div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${VIEW} ${VIEW}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          className="block h-36 w-full overflow-visible"
        >
          {[0.5, 1].map((fraction) => (
            <line
              key={fraction}
              x1={0}
              x2={VIEW}
              y1={VIEW - fraction * VIEW}
              y2={VIEW - fraction * VIEW}
              vectorEffect="non-scaling-stroke"
              strokeDasharray="2 3"
              className="stroke-border"
            />
          ))}
          {chart.areas.map((area, index) => (
            <path
              key={bands[index].key}
              d={area}
              className={USAGE_RAMP_FILL[USAGE_BAND_LEVELS[index] ?? 1]}
            />
          ))}
          {/* 堆叠的顶缘天然就是总计，故总计线不必另画一条数据 */}
          <path
            d={chart.outline}
            fill="none"
            strokeWidth={1.25}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            className="stroke-foreground/90"
          />
          <line
            x1={0}
            x2={VIEW}
            y1={VIEW}
            y2={VIEW}
            vectorEffect="non-scaling-stroke"
            className="stroke-border"
          />
        </svg>

        {/* 刻度值贴在它标注的那条线上方，靠左；文字不进 SVG，
            于是不随宽度变形 */}
        {[0.5, 1].map((fraction) => (
          <span
            key={fraction}
            aria-hidden="true"
            className="-translate-y-full pointer-events-none absolute left-0 pb-0.5 text-[10px] text-muted-foreground tabular-nums"
            style={{ top: `${(1 - fraction) * 100}%` }}
          >
            {formatAxis(chart.axisMax * fraction)}
          </span>
        ))}

        {/* 今日：折线最后一个点，与左栏那个大数字是同一个事实的两种画法 */}
        <span
          aria-hidden="true"
          className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute size-2 rounded-full bg-foreground ring-2 ring-card"
          style={{ left: "100%", top: `${(1 - chart.lastRatio) * 100}%` }}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 border-foreground/20 border-r border-dashed"
        />

        {/* 逐日命中列：首末各占半格，列心才落在数据点上 */}
        <div
          role="grid"
          aria-label={gridAriaLabel}
          className="absolute inset-0 flex"
        >
          {days.map((day, index) => (
            <Tooltip key={day}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="gridcell"
                  aria-label={label(index)}
                  data-day={day}
                  className={cn(
                    "group h-full cursor-default outline-none focus-visible:z-10",
                    index === 0 || index === days.length - 1
                      ? "flex-[0.5]"
                      : "flex-1"
                  )}
                >
                  <span className="mx-auto block h-full w-px bg-transparent transition-colors group-hover:bg-foreground/25 group-focus-visible:bg-foreground/40 motion-reduce:transition-none" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{label(index)}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      </div>

      <div
        aria-hidden="true"
        className="mt-1.5 flex justify-between text-[10px] text-muted-foreground"
      >
        {axisLabels.map((text, index) => (
          <span key={`${text}:${index}`}>{text}</span>
        ))}
      </div>
    </div>
  );
}
