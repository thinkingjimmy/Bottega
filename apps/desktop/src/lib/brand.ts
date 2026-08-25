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

export const PRODUCT_MARK_SIZE = { width: 1254, height: 1254 } as const;

export const PRODUCT_LOGO_URLS = {
  light: new URL("../assets/bottega-sidebar-logo.png", import.meta.url).href,
  dark: new URL("../assets/bottega-sidebar-logo-dark.png", import.meta.url).href,
} as const;

// 内在尺寸随资产走：写进 <img width/height> 才有正确的预留比例，图未解码那一帧不塌。
export const PRODUCT_LOGO_SIZE = { width: 751, height: 206 } as const;
