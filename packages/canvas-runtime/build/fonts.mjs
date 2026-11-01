/**
 * [INPUT]: Fixed OFL font registry, source/derivation identities, complete cmap and original license bytes; optional private module README is excluded from runtime inputs.
 * [OUTPUT]: Verified browser font-library assets and exact adopted input identities for the runtime receipt.
 * [POS]: Native font material build boundary; this does not select or substitute a document font.
 */
import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
export function verifiedFontLibrary(root) {
  const directory = join(root, "fonts"), names = ["LICENSE.txt", "NotoSansSC-VF.woff2", "registry.json", "cmap.json", "origin.json", "derivation.json", "upstream.tar.gz"];
  if (JSON.stringify(readdirSync(directory).filter(name => name !== "README.md").sort()) !== JSON.stringify([...names].sort())) throw new Error("Fixed font material scope changed");
  const inputs = names.map(path => {
    const file = join(directory, path); if (lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile()) throw new Error("Font material must be a regular file");
    const data = readFileSync(file); return { path, data, sha256: sha(data), bytes: data.length };
  });
  const get = name => { const file = inputs.find(file => file.path === name); if (!file) throw new Error("Fixed font material is missing"); return file; };
  const parse = name => JSON.parse(get(name).data.toString("utf8"));
  const registry = parse("registry.json"), origin = parse("origin.json"), proof = parse("derivation.json"), cmap = parse("cmap.json");
  const font = registry.fonts?.[0];
  if (registry.schemaVersion !== 1 || registry.fonts.length !== 1 || font?.id !== "noto-sans-sc-2.004" || font.family !== "Noto Sans SC" || font.version !== "2.004" || font.license.id !== "OFL-1.1" || font.style !== "normal" ||
      font.weight.min !== 100 || font.weight.max !== 900 || font.weight.default !== 100 || font.embeddingFsType !== 0)
    throw new Error("Fixed font variation or embedding identity changed");
  for (const [entry, expected] of [[font.file, origin.woff2Sha256], [font.license, origin.licenseSha256], [font.coverage, origin.cmapSha256]]) {
    const file = get(entry.path);
    if (file.sha256 !== expected || file.sha256 !== entry.sha256 || entry.bytes !== undefined && file.bytes !== entry.bytes) throw new Error("Fixed font member identity changed: " + entry.path);
  }
  if (get(font.file.path).bytes > 8 * 1024 * 1024 || get("upstream.tar.gz").sha256 !== origin.archiveSha256 || !get("LICENSE.txt").data.includes("SIL OPEN FONT LICENSE") ||
      proof.status !== "passed" || !proof.rebuild?.byteIdentical || proof.woff2Sha256 !== origin.woff2Sha256 || proof.sourceSha256 !== origin.sourceSha256 ||
      !proof.equalGlyphCoordinatesContoursFlags || !proof.equalPerGlyphInstructions) throw new Error("Fixed font provenance or glyph proof changed");
  let last = -1, points = 0;
  for (const range of cmap) {
    if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isInteger) || range[0] <= last || range[0] < 0 || range[1] < range[0] || range[1] > 0x10ffff ||
        range[0] <= 0xdfff && range[1] >= 0xd800) throw new Error("Fixed font cmap is invalid");
    last = range[1]; points += range[1] - range[0] + 1;
  }
  if (points !== font.coverage.codepoints || points !== proof.mappedCodepoints || font.coverage.glyphs !== proof.glyphs) throw new Error("Fixed font coverage changed");
  return { inputs: inputs.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })),
    files: ["NotoSansSC-VF.woff2", "registry.json", "cmap.json", "LICENSE.txt"].map(name => ({ path: "font-library/" + name, data: get(name).data })) };
}
