/**
 * [INPUT]: Validated relative resource names and bounded byte arrays.
 * [OUTPUT]: Deterministic regular-file tar archives and strictly checked in-memory extraction.
 * [POS]: Artifact snapshot archive codec shared by desktop custody and isolated browser shells.
 */
import { artifactRelativePathSchema } from "../turns/text/artifact-reference";
import { MAX_BLOB_BYTES } from "../config";
export type ArtifactFile = { path: string; data: Uint8Array };
const encoder = new TextEncoder(), decoder = new TextDecoder("utf-8", { fatal: true });
const blockSize = 512;
function field(block: Uint8Array, offset: number, size: number, value: string) {
  const bytes = encoder.encode(value);
  if (bytes.length > size) throw new Error("artifact-archive-name");
  block.set(bytes, offset);
}
function safeName(name: string) {
  artifactRelativePathSchema.parse(name);
  if (name.split("/").length > 4 || name.split("/").includes("node_modules")) throw new Error("artifact-archive-path");
  return name;
}
export function packArtifactArchive(files: readonly ArtifactFile[]): Uint8Array {
  if (!files.length || files.length > 200) throw new Error("artifact-archive-count");
  const sorted = [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (new Set(sorted.map(file => file.path)).size !== files.length) throw new Error("artifact-archive-duplicate");
  const size = sorted.reduce((total, file) => total + blockSize + Math.ceil(file.data.length / blockSize) * blockSize, 1024);
  if (size > MAX_BLOB_BYTES) throw new Error("artifact-archive-budget");
  const result = new Uint8Array(size);
  let offset = 0;
  for (const file of sorted) {
    const name = safeName(file.path), header = result.subarray(offset, offset + blockSize);
    const parts = name.split("/"); let prefix = "", suffix = name;
    while (encoder.encode(suffix).length > 100 && parts.length > 1) { prefix += (prefix ? "/" : "") + parts.shift(); suffix = parts.join("/"); }
    field(header, 0, 100, suffix); field(header, 345, 155, prefix);
    field(header, 100, 8, "0000600\0"); field(header, 108, 8, "0000000\0"); field(header, 116, 8, "0000000\0");
    field(header, 124, 12, file.data.length.toString(8).padStart(11, "0") + "\0");
    field(header, 136, 12, "00000000000\0"); header.fill(32, 148, 156); header[156] = 48;
    field(header, 257, 6, "ustar\0"); field(header, 263, 2, "00");
    field(header, 148, 8, header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0") + "\0 ");
    result.set(file.data, offset + blockSize); offset += blockSize + Math.ceil(file.data.length / blockSize) * blockSize;
  }
  return result;
}
export function unpackArtifactArchive(bytes: Uint8Array): ArtifactFile[] {
  if (bytes.length > MAX_BLOB_BYTES || bytes.length % blockSize) throw new Error("artifact-archive-budget");
  const files: ArtifactFile[] = [], names = new Set<string>();
  let offset = 0;
  while (offset + blockSize <= bytes.length) {
    const header = bytes.subarray(offset, offset + blockSize);
    if (header.every(byte => byte === 0)) {
      if (bytes.length - offset < 1024 || bytes.subarray(offset).some(byte => byte !== 0) || !files.length) throw new Error("artifact-archive-tail");
      return files;
    }
    const read = (start: number, size: number) => decoder.decode(header.subarray(start, start + size)).split("\0", 1)[0]!;
    const octal = (value: string) => { if (!/^[0-7]+$/.test(value.trim())) throw new Error("artifact-archive-number"); return parseInt(value.trim(), 8); };
    const checksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    if (octal(read(148, 8)) !== checksum || read(257, 6) !== "ustar" || ![0, 48].includes(header[156]!)) throw new Error("artifact-archive-header");
    const prefix = read(345, 155), path = safeName((prefix ? prefix + "/" : "") + read(0, 100));
    const size = octal(read(124, 12));
    if (!Number.isSafeInteger(size) || size < 0 || offset + blockSize + size > bytes.length || names.has(path) || files.length >= 200) throw new Error("artifact-archive-entry");
    names.add(path); files.push({ path, data: bytes.slice(offset + blockSize, offset + blockSize + size) });
    offset += blockSize + Math.ceil(size / blockSize) * blockSize;
  }
  throw new Error("artifact-archive-truncated");
}
