/**
 * [INPUT]: Depends on assets Bottega single graph, bright and dark side Logo and Vite import.meta.url asset analysis
 * [OUTPUT]: Provides PRODUCT_NAME, PRODUCT_MARK_URL/SIZE, PRODUCT_LOGO_URLS and PRODUCT_LOGO_SIZE
 * [POS]: The only true source of product identity is the renderer; Chat airspace uses single graphics, Sidebar page eyebrows are used to take horizontal tags according to the valid theme
 */

// 产品名是标识不是文案，故不进 i18n 目录；换名换图都只改这里一处，
// 消费点各自 new URL 的那一刻，资产改名就只会改对一半。
export const PRODUCT_NAME = "Bottega";

export const PRODUCT_MARK_URL = new URL(
  "../assets/bottega-mark.png",
  import.meta.url
).href;

// 画布贴着墨迹裁，这是硬约束而非顺手为之：留白一旦烘焙进 PNG，它就成了每个
// 消费点都看不见、却都要跟它较劲的偏移量——单图曾在 1254² 画布里只占
// 817×880，于是 Settings › About 里 size-20 的盒子左缘与下方卡片对齐、可见
// 徽标却右移 14px；min-h-20 说等高，眼睛看到的却是 56px。补偿改不动根因：
// 换一次导出，所有补偿数就集体作废。留白是排版的职责，不是资产的。
export const PRODUCT_MARK_SIZE = { width: 817, height: 880 } as const;

export const PRODUCT_LOGO_URLS = {
  light: new URL("../assets/bottega-sidebar-logo.png", import.meta.url).href,
  dark: new URL("../assets/bottega-sidebar-logo-dark.png", import.meta.url).href,
} as const;

// 内在尺寸随资产走：写进 <img width/height> 才有正确的预留比例，图未解码那一帧不塌。
export const PRODUCT_LOGO_SIZE = { width: 751, height: 206 } as const;
