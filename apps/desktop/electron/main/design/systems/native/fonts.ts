/**
 * [INPUT]: Original canonical System, bounded native font descriptors and exact uploaded project bytes.
 * [OUTPUT]: Safe font descriptors, immutable binary source captures and preserved existing provenance.
 * [POS]: System font upload boundary; fonts share the existing source journal and resource closure.
 */
import { systemFontSchema, type DesignSystem } from "@ai-chat/cloud-protocol/artifacts/design/system/model";
import { sourcePath, designDigest } from "../../documents/model";
type Font = { family: string; file: string; weight: string; style: "normal" | "italic" | "oblique" };
function validateFont(bytes: Uint8Array, path: string) {
  if (bytes.length < 12 || bytes.length > 24 * 1024 * 1024) throw new Error("Font size is invalid");
  const data = Buffer.from(bytes), header = data.toString("latin1", 0, 4), count = data.readUInt16BE(header === "wOFF" || header === "wOF2" ? 12 : 4);
  if (!count || count > 512) throw new Error("Font table count is invalid");
  if (header === "wOFF" || header === "wOF2") {
    if (!path.endsWith(header === "wOF2" ? ".woff2" : ".woff") || data.length < (header === "wOF2" ? 48 : 44) || data.readUInt32BE(8) !== data.length || data.readUInt16BE(14) !== 0 || data.readUInt32BE(16) > 64 * 1024 * 1024) throw new Error("Font container does not match its bytes");
    if (header === "wOFF" && 44 + count * 20 > data.length || header === "wOF2" && (!data.readUInt32BE(20) || data.readUInt32BE(20) > data.length - 48)) throw new Error("Font container is truncated");
  } else {
    if (header !== "OTTO" && data.readUInt32BE(0) !== 0x00010000 || !/\.(?:ttf|otf)$/.test(path) || 12 + count * 16 > data.length) throw new Error("Font signature is invalid");
    for (let index = 0; index < count; index++) { const start = 12 + index * 16, offset = data.readUInt32BE(start + 8), length = data.readUInt32BE(start + 12); if (offset + length > data.length) throw new Error("Font table is truncated"); }
  }
}
export function applySystemFonts(system: DesignSystem, incoming: readonly Font[], projected: ReadonlyMap<string, Uint8Array>, result: Map<string, Uint8Array>, editorId: string) {
  const previous = system.tokens.fonts, seen = new Set<string>();
  system.tokens.fonts = incoming.map(font => {
    const local = sourcePath.parse(font.file.startsWith("project/") ? font.file.slice(8) : font.file);
    let bytes = projected.get("project/" + local);
    const prior = previous.find(value => value.file === local && value.family === font.family && value.weight === font.weight && value.style === font.style);
    if (!bytes) {
      const index = projected.get("project/design-system.json");
      if (!index || index.length > 1024 * 1024) throw new Error("The font storage index is missing or oversized");
      const records: unknown[] = Object.values(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(index)).blobs ?? {});
      const matches = records.filter((entry): entry is { name: string; blob: string; size: number; type: string; sha256?: string } => Boolean(entry && typeof entry === "object" && "name" in entry && entry.name === local));
      if (matches.length !== 1) throw new Error("The font needs one exact storage record");
      const record = matches[0]!;
      if (!/^[a-f0-9]{32}$/.test(record.blob) || !Number.isSafeInteger(record.size) || !["font/woff2", "font/woff", "font/ttf", "font/otf"].includes(record.type)) throw new Error("The font storage record is invalid");
      const extension = local.split(".").at(-1)!;
      bytes = projected.get("project/assets/" + record.blob + "." + extension);
      if (!bytes || bytes.length !== record.size || designDigest(bytes).slice(7, 39) !== record.blob || record.sha256 !== undefined && designDigest(bytes) !== "sha256:" + record.sha256) throw new Error("The stored font bytes do not match their record");
    }
    if (seen.has(font.file + JSON.stringify([font.family, font.weight, font.style]))) throw new Error("Duplicate font descriptor"); seen.add(font.file + JSON.stringify([font.family, font.weight, font.style]));
    if (!bytes || !/^fonts\/[^/]+\.(?:woff2?|ttf|otf)$/.test(local) && !previous.some(value => value.file === local)) throw new Error("Font source is missing or outside the upload directory");
    validateFont(bytes, local); const digest = designDigest(bytes), existing = prior && system.sources.files.find(source => source.id === prior.sourceId);
    if (prior && existing?.digest === digest) { result.set(local, bytes); return prior; }
    const extension = local.split(".").at(-1)!, capturedPath = "captured/fonts/" + digest.slice(7) + "." + extension, sourceId = "font-" + digest.slice(7, 39);
    const conflict = system.sources.files.find(source => source.id === sourceId);
    if (conflict && (conflict.digest !== digest || conflict.capturedPath !== capturedPath)) throw new Error("Font capture identity conflicts with an existing source");
    if (!conflict) system.sources.files.push({ id: sourceId, path: local, capturedPath, digest, bytes: bytes.length, version: { kind: "digest", digest } });
    result.set(capturedPath, bytes); result.set(local, bytes);
    return systemFontSchema.parse({ ...font, file: local, sourceId, definitionSourceId: editorId, sourceKey: local });
  });
}
