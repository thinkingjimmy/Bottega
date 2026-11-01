/**
 * [INPUT]: Verified packaged native font-library registry, coverage, binary and license assets.
 * [OUTPUT]: FixedDesignFont materials, bounded catalog metadata and exact Unicode coverage checks.
 * [POS]: Native font source boundary; presence or coverage never substitutes for actual output glyph verification.
 */
import { z } from "zod";
import { nativeEditorAssets } from "../../../artifacts/render/native/assets";
import { designDigest } from "../../documents/model";
const member = z.object({ path: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/), sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().positive() });
const fontSchema = z.object({ id: z.literal("noto-sans-sc-2.004"), family: z.literal("Noto Sans SC"), version: z.literal("2.004"), style: z.literal("normal"),
  weight: z.object({ min: z.literal(100), max: z.literal(900), default: z.literal(100) }), file: member,
  license: member.extend({ id: z.literal("OFL-1.1") }), coverage: member.omit({ bytes: true }).extend({ glyphs: z.literal(31036), codepoints: z.literal(30890) }),
  sourceHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1).max(2), embeddingFsType: z.literal(0) });
export type FixedDesignFont = { info: z.infer<typeof fontSchema>; bytes: Uint8Array; license: Uint8Array; ranges: readonly [number, number][] };
let current: Promise<FixedDesignFont> | undefined;
export function fixedDesignFont(): Promise<FixedDesignFont> {
  return current ??= load().catch(cause => { current = undefined; throw cause; });
}
async function load(): Promise<FixedDesignFont> {
  const assets = await nativeEditorAssets();
  const registry = assets.get("font-library/registry.json");
  if (!registry || registry.length > 16 * 1024) throw new Error("The fixed native font registry is unavailable");
  const info = z.object({ schemaVersion: z.literal(1), fonts: z.array(fontSchema).length(1) }).parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(registry))).fonts[0]!;
  const get = (entry: { path: string; sha256: string; bytes?: number }) => {
    const bytes = assets.get("font-library/" + entry.path);
    if (!bytes || entry.bytes !== undefined && bytes.length !== entry.bytes || designDigest(bytes) !== "sha256:" + entry.sha256) throw new Error("Fixed native font identity changed");
    return bytes;
  };
  const bytes = get(info.file), license = get(info.license), cmap = get(info.coverage);
  if (bytes.length > 8 * 1024 * 1024 || license.length > 64 * 1024 || cmap.length > 64 * 1024) throw new Error("Fixed native font material exceeds its budget");
  const ranges = z.array(z.tuple([z.number().int().nonnegative(), z.number().int().max(0x10ffff)])).max(1024).parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(cmap)));
  let last = -1, count = 0;
  for (const [first, end] of ranges) { if (first <= last || end < first) throw new Error("Fixed native font coverage is invalid"); last = end; count += end - first + 1; }
  if (count !== info.coverage.codepoints || !info.sourceHashes.includes(info.file.sha256)) throw new Error("Fixed native font coverage identity changed");
  return { info, bytes, license, ranges };
}
export function designFontCatalog(font: FixedDesignFont) {
  return { id: font.info.id, family: font.info.family, version: font.info.version, style: font.info.style, weight: font.info.weight,
    license: font.info.license.id, glyphs: font.info.coverage.glyphs, codepoints: font.info.coverage.codepoints, sourceDigest: "sha256:" + font.info.file.sha256 };
}
export function missingFontCodepoints(font: FixedDesignFont, text: string): number[] {
  const missing = new Set<number>();
  for (const char of text.normalize("NFC")) {
    const point = char.codePointAt(0)!; if (point < 32 || point === 0x200b || point === 0x200d || point === 0xfeff) continue;
    let low = 0, high = font.ranges.length - 1, found = false;
    while (low <= high) { const index = (low + high) >>> 1, [first, end] = font.ranges[index]!;
      if (point < first) high = index - 1; else if (point > end) low = index + 1; else { found = true; break; } }
    if (!found) missing.add(point);
  }
  return [...missing].sort((a, b) => a - b);
}
