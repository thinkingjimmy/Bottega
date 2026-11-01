/**
 * [INPUT]: Owner-verified font metadata/byte identities and actual per-run browser font/glyph observations.
 * [OUTPUT]: Bounded strict native font proof or an explicit fixed-byte/face/weight/style/glyph/fallback refusal.
 * [POS]: Shared output font admission; callers must collect evidence from the actual fixed producer, not authored messages.
 */
export type NativeFontRun = { text: string; family: string; weight: number; style: string;
  fonts: { familyName: string; isCustomFont: boolean; glyphCount: number }[] };
export type NativeFontFaceEvidence = { family: string; digest: string; loaded: boolean; weight: readonly [number, number]; style: string };
export type NativeFixedFont = { id: string; family: string; digests: readonly string[]; weight: { min: number; max: number }; style: string;
  ranges: readonly (readonly [number, number])[] };
const familyName = (value: string) => value.trim().replace(/^["']|["']$/g, "").normalize("NFC").toLowerCase();
export class NativeFontError extends Error {
  constructor(readonly code: string, readonly detail: { family?: string; weight?: number; style?: string; missing?: number[] } = {}) {
    super(code + ": Review a fixed font or an explicit picture variant before exporting"); this.name = "NativeFontError";
  }
}
export function verifyNativeFontRuns(runs: readonly NativeFontRun[], faces: readonly NativeFontFaceEvidence[], font: NativeFixedFont) {
  if (runs.length > 2048 || faces.length > 64 || runs.reduce((sum, run) => sum + new TextEncoder().encode(run.text).length, 0) > 1024 * 1024)
    throw new NativeFontError("FONT_EVIDENCE_BUDGET");
  const digests = new Set<string>(), expected = familyName(font.family); let glyphs = 0, count = 0;
  const covered = (point: number) => {
    let low = 0, high = font.ranges.length - 1;
    while (low <= high) { const middle = (low + high) >>> 1, [first, last] = font.ranges[middle]!;
      if (point < first) high = middle - 1; else if (point > last) low = middle + 1; else return true; }
    return false;
  };
  for (const run of runs) {
    if (!run.text.trim()) continue; count++;
    const detail = { family: run.family, weight: run.weight, style: run.style };
    if (familyName(run.family) !== expected) throw new NativeFontError("UNFIXED_FONT", detail);
    if (!Number.isFinite(run.weight) || run.weight < font.weight.min || run.weight > font.weight.max) throw new NativeFontError("FONT_WEIGHT_UNSUPPORTED", detail);
    if (run.style !== font.style) throw new NativeFontError("FONT_STYLE_UNSUPPORTED", detail);
    const matching = faces.filter(face => familyName(face.family) === expected && face.loaded && face.style === run.style &&
      face.weight[0] <= run.weight && face.weight[1] >= run.weight);
    if (!matching.length) throw new NativeFontError("FONT_FACE_UNAVAILABLE", detail);
    if (matching.some(face => !font.digests.includes(face.digest))) throw new NativeFontError("FONT_BYTES_CHANGED", detail);
    const missing = new Set<number>();
    for (const character of run.text.normalize("NFC")) {
      const point = character.codePointAt(0)!;
      if (point < 32 || point === 0x200b || point === 0x200d || point === 0xfeff) continue;
      if (!covered(point)) missing.add(point);
    }
    if (missing.size) throw new NativeFontError("FONT_GLYPHS_MISSING", { ...detail, missing: [...missing].sort((a, b) => a - b).slice(0, 32) });
    const actual = run.fonts.filter(value => value.glyphCount > 0);
    if (!actual.length) throw new NativeFontError("FONT_EVIDENCE_MISSING", detail);
    if (actual.some(value => !value.isCustomFont || familyName(value.familyName) !== expected || !Number.isFinite(value.glyphCount)))
      throw new NativeFontError("FONT_FALLBACK", detail);
    for (const value of actual) glyphs += value.glyphCount;
    for (const face of matching) digests.add(face.digest);
  }
  return { status: "verified" as const, fontId: font.id, family: font.family, runs: count, glyphs, digests: [...digests].sort() };
}
