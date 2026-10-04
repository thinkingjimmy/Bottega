/**
 * [INPUT]: Bundled Forward Console product icon.
 * [OUTPUT]: Canonical product name, icon URL and intrinsic dimensions.
 * [POS]: Shared product identity for desktop and browser surfaces.
 */


export const PRODUCT_NAME = "Bottega";

export const PRODUCT_MARK_URL = new URL(
  "../../assets/brand/bottega-mark.webp",
  import.meta.url
).href;

export const PRODUCT_MARK_SIZE = { width: 512, height: 512 } as const;
