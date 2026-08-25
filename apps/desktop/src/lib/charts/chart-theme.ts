/**
 * [INPUT]: Depends on browser computed style and injectable 1×1 canvas pixel readability
 * [OUTPUT]: Provides ChartTheme, normalize CSSColor and readChartTheme
 * [POS]: The CSS→sRGB thematic boundaries of lib/charts; Hex is directed, the rest is canvasized to zrender, and the comma rgb/rgba is solvable
 */

export type ChartTheme = {
  palette: string[];
  text: string;
  axis: string;
  background: string;
};

export type ColorCanvasFactory = () => Pick<
  HTMLCanvasElement,
  "getContext" | "width" | "height"
>;

export function normalizeCssColor(
  color: string,
  createCanvas: ColorCanvasFactory = () => document.createElement("canvas")
) {
  const value = color.trim();
  if (/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) return value;
  const canvas = createCanvas();
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return value;
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
  // ── ECharts 的 zrender 颜色解析器只认逗号分隔语法，空格语法会静默落黑 ──
  return alpha === 255
    ? `rgb(${red}, ${green}, ${blue})`
    : `rgba(${red}, ${green}, ${blue}, ${Number((alpha / 255).toFixed(3))})`;
}

export function readChartTheme(element: HTMLElement): ChartTheme {
  const style = getComputedStyle(element);
  const token = (name: string) => style.getPropertyValue(name).trim();
  const palette = [1, 2, 3, 4, 5].map((index) => token(`--chart-${index}`));
  return {
    palette,
    text: normalizeCssColor(token("--foreground")),
    axis: normalizeCssColor(token("--border")),
    background: normalizeCssColor(token("--background")),
  };
}
