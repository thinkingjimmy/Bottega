/**
 * [INPUT]: Bundled product mark and light/dark wordmarks.
 * [OUTPUT]: Canonical product identity and asset URLs.
 * [POS]: Shared product brand; guests may retain their website icon.
 */


export const PRODUCT_NAME = "Bottega";

export const PRODUCT_MARK_URL = new URL(
  "../../assets/brand/bottega-mark.png",
  import.meta.url
).href;

export const PRODUCT_MARK_SIZE = { width: 817, height: 880 } as const;

export const PRODUCT_LOGO_URLS = {
  light: new URL("../../assets/brand/bottega-sidebar-logo.png", import.meta.url).href,
  dark: new URL("../../assets/brand/bottega-sidebar-logo-dark.png", import.meta.url).href,
} as const;

export const PRODUCT_LOGO_SIZE = { width: 751, height: 206 } as const;
