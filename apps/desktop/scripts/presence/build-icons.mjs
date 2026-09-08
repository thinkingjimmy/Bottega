/**
 * [INPUT]: Depends on Authored monochrome speech-bubble SVG and sharp rasterization.
 * [OUTPUT]: Provides deterministic template and Retina menu-bar PNG assets.
 * [POS]: Presence asset authoring step; runtime uses committed small-size resources.
 */

import { Buffer } from "node:buffer";
import { URL } from "node:url";
import sharp from "sharp";
import { fileURLToPath } from "node:url";
const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><g fill="none" stroke="black" stroke-width="1.5" stroke-linejoin="round"><path d="M3 3.5h9a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7l-3 2v-2H3a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Z"/><path d="M15.5 6v6.5a2 2 0 0 1-2 2H9"/></g><circle cx="5" cy="8" r="1"/><circle cx="10" cy="8" r="1"/></svg>`);
for (const scale of [1, 2]) {
  const name = scale === 1 ? "trayTemplate.png" : "trayTemplate@2x.png";
  await sharp(svg).resize(18 * scale, 18 * scale).png().toFile(fileURLToPath(new URL(`../../resources/presence/${name}`, import.meta.url)));
}
