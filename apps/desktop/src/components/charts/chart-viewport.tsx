/**
 * [INPUT]: Depends on React, shared ChartPayload, obviously unobstructed color selection, LazyChart and the IntersectionObserver rooting roots
 * [OUTPUT]: Provides ChartViewport (including accessibleColors/cornerReserved display strategy)  ChartComponent types and payloads are accessible to description/data tables on demand; When the data input is stationary, the pointer-events together with the open area, hover/focus-visible/open mode triad, are used to return it
 * [POS]: The eager host kernel of components/charts; With a figure/IO/place/head animation box, ECharts lifecycle declines ChartCore
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent,
} from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import type { ChartPayload } from "../../../shared/chart-payload";
import type { ChartRenderPolicy } from "@/lib/charts/chart-option";
import { LazyChart } from "./chart-lazy";

export type ChartComponent = ComponentType<{
  payload: ChartPayload;
  policy: ChartRenderPolicy;
  onReady?: () => void;
}>;

export function chartAriaLabel(payload: ChartPayload) {
  const names: Record<ChartPayload["type"], string> = {
    pie: "饼图",
    bar: "柱状图",
    line: "折线图",
    "stacked-bar": "堆叠柱状图",
    scatter: "散点图",
    radar: "雷达图",
    heatmap: "热力图",
  };
  const title = payload.title ? `：${payload.title}` : "";
  return `${names[payload.type]}${title}，${payload.labels.length} 个刻度、${payload.series.length} 条序列`;
}

/* ── 命中区 44px，身形交还图表 ────────────────────────────────────
 * 浮层动作是图表的客人。把控件本身撑成 min-h-11，命中区是达标了，
 * 代价是一块 44px 的实心色板长年压在数据上——它开始像第二张图。
 * 「看起来多大」与「点得中多大」本是两件事：控件保持 sm 密度，
 * ::after 独自把命中区撑到 44px。同 view-config-bar 的教条，几何不同：
 * 那里是密排设置条只需竖向让位，这里是孤身浮标，横向本已够宽。
 *
 * 不带 relative：宿主已是 absolute，自身就是 ::after 的包含块。多写一个
 * relative 不是冗余而是拆台——它与 absolute 同属 position 组，经 cn 的
 * tailwind-merge 后写在后面的赢，按钮当场掉回文档流飞出卡片。
 * ────────────────────────────────────────────────────────────── */
const actionHitAreaClass =
  "after:absolute after:inset-x-0 after:-inset-y-2.5 after:content-['']";

/* ── 客人只在主人抬眼时现身 ────────────────────────────────────────
 * 图表一直画到 figure 的边，绘图区里没有空地：一枚常显的实心动作压着的
 * 从来不是留白，而是最右那格刻度标签。前两轮修的是「抢指针」「被圆角削角」，
 * 那是几何冲突；遮挡是另一回事——只要它常显且不透明，遮挡就必然发生，
 * 挪个位置只是换一格数据来遮。
 *
 * 故改为显现通道，与同一张卡右下角的 resize 抓手同一种语言：静止时让开，
 * 指针落进图表或键盘走到它身上才现身。三点必须一起写，缺一个都是半截：
 *   1. pointer-events 与 opacity 同进同退——只隐形不让路，等于在刻度上
 *      挖了一块看不见的死区，ECharts 的 tooltip 从此在那角失灵；
 *   2. 粗指针没有 hover 可言，那里保持常显（与抓手同一条豁免）；
 *   3. 数据表开着时钉住——关闭它的那枚控件不能自己消失，否则浮层再也关不掉。
 *      钉住走 aria-expanded：属性选择器的特异性天然压过媒体查询里的类，
 *      不必去赌 Tailwind 把哪条变体排在后面。
 *
 * 类名一律写全字面量：Tailwind 扫的是源码里的字符串，拼接出来的候选它看不见——
 * 拼一次省下的几个字符，换来的是运行时那条类根本没被生成。
 * ────────────────────────────────────────────────────────────── */
const actionRevealClass =
  "transition-opacity motion-reduce:transition-none [@media(hover:hover)_and_(pointer:fine)]:pointer-events-none [@media(hover:hover)_and_(pointer:fine)]:opacity-0 [@media(hover:hover)_and_(pointer:fine)]:group-hover/chart-viewport:pointer-events-auto [@media(hover:hover)_and_(pointer:fine)]:group-hover/chart-viewport:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:focus-visible:pointer-events-auto [@media(hover:hover)_and_(pointer:fine)]:focus-visible:opacity-100 aria-expanded:pointer-events-auto aria-expanded:opacity-100";

export function ChartViewport({
  payload,
  accessibleColors,
  scrollRoot,
  defer = false,
  className = "h-[280px]",
  cornerReserved = false,
  ChartComponent = LazyChart,
}: {
  payload: ChartPayload;
  /** 宿主必须自己选择视觉纹理策略，禁止共享内核暗藏产品默认值。 */
  accessibleColors: boolean;
  scrollRoot?: Element | null;
  defer?: boolean;
  className?: string;
  /** 宿主已占住右下角（dashboard 卡片的 resize 抓手），动作条整体左让 */
  cornerReserved?: boolean;
  ChartComponent?: ChartComponent;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canDefer = defer && typeof IntersectionObserver !== "undefined";
  const [visible, setVisible] = useState(!canDefer);
  const [tableOpen, setTableOpen] = useState(false);
  const reducedMotion = useMemo(
    () =>
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );
  const [animation, setAnimation] = useState(!reducedMotion);
  const policy: ChartRenderPolicy = { animation, accessibleColors };
  useEffect(() => {
    if (!canDefer) return;
    const target = rootRef.current;
    if (!target) return;
    let destroyed = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (destroyed) return;
        const next = entries.some((entry) => entry.isIntersecting);
        setVisible(next);
      },
      { root: scrollRoot ?? null, rootMargin: "200% 0px" }
    );
    observer.observe(target);
    return () => {
      destroyed = true;
      observer.disconnect();
    };
  }, [canDefer, scrollRoot]);
  const markRendered = useCallback(() => {
    setAnimation(false);
  }, []);
  const stop = (event: MouseEvent) => event.stopPropagation();
  return (
    <figure
      aria-label={chartAriaLabel(payload)}
      className={`group/chart-viewport relative min-w-0 ${className}`}
      ref={rootRef}
    >
      <div aria-hidden="true" className="size-full">
        {visible ? (
          <ChartComponent
            onReady={markRendered}
            payload={payload}
            policy={policy}
          />
        ) : (
          <div className="size-full rounded-md bg-muted/30" />
        )}
      </div>
      <Button
        aria-expanded={tableOpen}
        className={`absolute bottom-1 ${cornerReserved ? "right-12" : "right-1"} shadow-sm ${actionHitAreaClass} ${actionRevealClass}`}
        onClick={(event) => {
          stop(event);
          setTableOpen((value) => !value);
        }}
        size="sm"
        type="button"
        variant="secondary"
      >
        {tableOpen ? "收起数据" : "查看数据"}
      </Button>
      {tableOpen && (
        <SlimScroller
          className="absolute inset-x-1 bottom-8 z-20 max-h-48 overflow-auto rounded-md border bg-background p-2 shadow-lg"
          onClick={stop}
        >
          <ChartDataTable payload={payload} />
        </SlimScroller>
      )}
    </figure>
  );
}

function ChartDataTable({ payload }: { payload: ChartPayload }) {
  return (
    <table className="w-full border-collapse text-left text-xs">
      <caption className="sr-only">{payload.title ?? "图表数据"}</caption>
      <thead>
        <tr>
          <th className="border-b p-1">标签</th>
          {payload.series.map((series, index) => (
            <th className="border-b p-1" key={`${series.name}:${index}`}>
              {series.name ?? `序列 ${index + 1}`}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {payload.labels.map((label, labelIndex) => (
          <tr key={`${label}:${labelIndex}`}>
            <th className="border-b p-1 font-normal">{label}</th>
            {payload.series.map((series, seriesIndex) => (
              <td className="border-b p-1" key={seriesIndex}>
                {series.data[labelIndex] ?? "—"}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
