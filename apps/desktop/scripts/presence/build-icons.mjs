/**
 * [INPUT]: Depends on the canonical transparent Bottega product mark and sharp rasterization.
 * [OUTPUT]: Provides 18px and 36px monochrome macOS templates and full-color system tray icons.
 * [POS]: Deterministic brand asset build step; runtime consumes committed small-size resources.
 */

import sharp from "sharp";
import { Buffer } from "node:buffer";
import { fileURLToPath, URL } from "node:url";
const source = fileURLToPath(new URL("../../src/assets/bottega-mark.png", import.meta.url));
const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const template = Buffer.from(data);
for (let offset = 0; offset < template.length; offset += 4) {
  // Dark insets become transparent; the light body and colored terminal glyph keep the mark recognizable.
  template[offset + 3] = Math.max(data[offset], data[offset + 1], data[offset + 2]) >= 180 ? data[offset + 3] : 0;
  template.fill(0, offset, offset + 3);
}

for (const scale of [1, 2]) {
  const suffix = scale === 1 ? ".png" : "@2x.png";
  for (const [name, raster] of [["trayIcon", sharp(source)], ["trayTemplate", sharp(template, { raw: info })]]) {
    await raster.resize(18 * scale, 18 * scale, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png().toFile(fileURLToPath(new URL(`../../resources/presence/${name}${suffix}`, import.meta.url)));
  }
}
