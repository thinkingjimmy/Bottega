/**
 * [INPUT]: dependence when not in operation; Color values are the Tailwind diameters, which are recognizable by the scanner
 * [OUTPUT]: Provides two projections of the neutral color stages (a square background / area fill) with two rank tables "facing backwards, linearly into a file"
 * [POS]: The settings/usage sub-module is a single truth source in the color stages; The heat graph, the curve area and the proportional fraction share it
 */

/* ============================================================
 * 一条 ramp，两种投影。
 *
 * 强度只由明度承载，不借任何色相：亮色下由浅灰走到近黑，暗色下同一条
 * 阶梯照镜子翻转成白色透明度。换主题、换品牌都不必重挑一组颜色。
 *
 * 两个数组必须逐字面量写出来——Tailwind 只扫描源码里的完整类名，
 * 拼接出来的类名不会被编译。它们是同一条 ramp 的两种投影：格子用
 * background，SVG 面积用 fill。
 * ============================================================ */

export const USAGE_RAMP_BG = [
  "bg-[#f1f3f5] dark:bg-white/8",
  "bg-[#d5d7da] dark:bg-white/20",
  "bg-[#9ba0a6] dark:bg-white/38",
  "bg-[#575c62] dark:bg-white/60",
  "bg-[#17191c] dark:bg-white/88",
] as const;

export const USAGE_RAMP_FILL = [
  "fill-[#f1f3f5] dark:fill-white/8",
  "fill-[#d5d7da] dark:fill-white/20",
  "fill-[#9ba0a6] dark:fill-white/38",
  "fill-[#575c62] dark:fill-white/60",
  "fill-[#17191c] dark:fill-white/88",
] as const;

/* ============================================================
 * 同一条 ramp 上取哪一档，由这块色要占多大面积决定：一整片面积
 * 用深色会把整页的墨量压过去，一条 1px 的线用浅色又会当场消失。
 * 故面退一档、线与细条进一档——补的是面积，不是层级。
 *
 * 档位按源的固定次序取，不按当日大小排：一个源的明度必须是它的
 * 身份，不能今天深明天浅。
 * ============================================================ */

/** 面（折线堆叠区）：3 → 2 → 1 */
export const USAGE_BAND_LEVELS = [3, 2, 1] as const;

/** 线与细条（占比条）：4 → 3 → 2 */
export const USAGE_MARK_LEVELS = [4, 3, 2] as const;
