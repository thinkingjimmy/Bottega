/**
 * [INPUT]: Bounded regular project members or untrusted complete ZIP bytes.
 * [OUTPUT]: Deterministic standard ZIP and independent CRC-verified in-memory members with strict resource/path limits.
 * [POS]: Complete-project archive codec; it never reads or extracts filesystem paths.
 */
import { inflateRawSync } from "node:zlib";
export const PROJECT_ZIP_LIMITS = Object.freeze({ entries: 4096, transfer: 50_000_000, expanded: 128 * 1024 * 1024, versions: 500 });
export type ProjectMember = { path: string; data: Uint8Array };
const encoder = new TextEncoder(), decoder = new TextDecoder("utf-8", { fatal: true });
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => { let value = index; for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1; return value >>> 0; });
const crc32 = (bytes: Uint8Array) => { let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255]! ^ crc >>> 8; return (crc ^ 0xffffffff) >>> 0; };
function memberName(path: string) {
  if (typeof path !== "string" || path.length > 1024 || path.split("/").length > 8 || path.split("/").some(part => !/^[A-Za-z0-9_][A-Za-z0-9_. -]{0,239}$/.test(part) || /[. ]$/.test(part) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part))) throw new Error("Unsafe project ZIP member path");
  return path;
}
function uniqueNames(paths: readonly string[]) {
  if (!paths.length || paths.length > PROJECT_ZIP_LIMITS.entries) throw new Error("Project ZIP member count exceeds its budget");
  const keys = paths.map(path => memberName(path).toLowerCase()).sort();
  for (let i = 0; i < keys.length; i++) if (keys[i] === keys[i + 1] || keys[i + 1]?.startsWith(keys[i]! + "/")) throw new Error("Duplicate or file/parent project ZIP collision");
}
export function packProjectZip(input: readonly ProjectMember[], signal?: AbortSignal): Uint8Array {
  signal?.throwIfAborted(); uniqueNames(input.map(file => file.path));
  const files = [...input].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0), expanded = files.reduce((total, file) => total + file.data.byteLength, 0);
  if (expanded > PROJECT_ZIP_LIMITS.expanded) throw new Error("Project ZIP expanded bytes exceed their budget");
  const size = files.reduce((total, file) => total + 76 + encoder.encode(file.path).length * 2 + file.data.length, 22);
  if (size > PROJECT_ZIP_LIMITS.transfer) throw new Error("Project ZIP transfer bytes exceed their budget");
  const bytes = new Uint8Array(size), view = new DataView(bytes.buffer), entries: { offset: number; name: Uint8Array; crc: number; size: number }[] = []; let at = 0;
  const u16 = (offset: number, value: number) => view.setUint16(offset, value, true), u32 = (offset: number, value: number) => view.setUint32(offset, value, true);
  for (const file of files) {
    signal?.throwIfAborted(); const name = encoder.encode(file.path), crc = crc32(file.data), size = file.data.length;
    entries.push({ offset: at, name, crc, size }); u32(at, 0x04034b50); u16(at + 4, 20); u16(at + 6, 0x800); u16(at + 12, 0x21);
    u32(at + 14, crc); u32(at + 18, size); u32(at + 22, size); u16(at + 26, name.length); bytes.set(name, at + 30); bytes.set(file.data, at + 30 + name.length); at += 30 + name.length + size;
  }
  const directory = at;
  for (const entry of entries) {
    signal?.throwIfAborted(); u32(at, 0x02014b50); u16(at + 4, 0x314); u16(at + 6, 20); u16(at + 8, 0x800); u16(at + 14, 0x21);
    u32(at + 16, entry.crc); u32(at + 20, entry.size); u32(at + 24, entry.size); u16(at + 28, entry.name.length); u32(at + 38, (0o100600 << 16) >>> 0); u32(at + 42, entry.offset); bytes.set(entry.name, at + 46); at += 46 + entry.name.length;
  }
  u32(at, 0x06054b50); u16(at + 8, entries.length); u16(at + 10, entries.length); u32(at + 12, at - directory); u32(at + 16, directory); return bytes;
}
export function unpackProjectZip(bytes: Uint8Array, signal?: AbortSignal): ProjectMember[] {
  signal?.throwIfAborted();
  if (bytes.length < 22 || bytes.length > PROJECT_ZIP_LIMITS.transfer) throw new Error("Project ZIP transfer budget or end record is invalid");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), end = bytes.length - 22;
  const u16 = (offset: number) => view.getUint16(offset, true), u32 = (offset: number) => view.getUint32(offset, true);
  if (u32(end) !== 0x06054b50 || u16(end + 4) || u16(end + 6) || u16(end + 20) || u16(end + 8) !== u16(end + 10)) throw new Error("Unsupported or truncated project ZIP end record");
  const count = u16(end + 10), directory = u32(end + 16), length = u32(end + 12);
  if (!count || count > PROJECT_ZIP_LIMITS.entries || directory + length !== end) throw new Error("Project ZIP directory or member budget is invalid");
  const records: { path: string; name: Uint8Array; flags: number; method: number; crc: number; size: number; compressed: number; local: number }[] = []; let at = directory, expanded = 0;
  for (let index = 0; index < count; index++) {
    signal?.throwIfAborted(); if (at + 46 > end || u32(at) !== 0x02014b50) throw new Error("Truncated project ZIP directory record");
    const nameSize = u16(at + 28), extra = u16(at + 30), comment = u16(at + 32), flags = u16(at + 8), method = u16(at + 10), size = u32(at + 24), mode = u32(at + 38) >>> 16;
    if (at + 46 + nameSize + extra + comment > end || !nameSize || extra || comment || u16(at + 34)) throw new Error("Unsupported project ZIP member record");
    if (flags !== 0 && flags !== 0x800 || ![0, 8].includes(method)) throw new Error("Unsupported encrypted/descriptor ZIP flags or compression");
    if (mode && (mode & 0o170000) !== 0o100000 || u32(at + 38) & 0x10) throw new Error("Project ZIP links and non-regular members are refused");
    expanded += size; if (expanded > PROJECT_ZIP_LIMITS.expanded) throw new Error("Project ZIP expanded bytes exceed their budget");
    const name = bytes.slice(at + 46, at + 46 + nameSize), path = memberName(decoder.decode(name));
    records.push({ path, name, flags, method, size, crc: u32(at + 16), compressed: u32(at + 20), local: u32(at + 42) }); at += 46 + nameSize;
  }
  if (at !== end) throw new Error("Project ZIP directory length is inconsistent"); uniqueNames(records.map(file => file.path));
  const output: ProjectMember[] = []; let offset = 0;
  for (const record of records.sort((a, b) => a.local - b.local)) {
    signal?.throwIfAborted(); const at = record.local;
    if (at !== offset || at + 30 > directory || u32(at) !== 0x04034b50) throw new Error("Project ZIP local record overlaps or has an invalid identity");
    const nameSize = u16(at + 26), extra = u16(at + 28), start = at + 30 + nameSize + extra, finish = start + record.compressed;
    if (extra || finish > directory || u16(at + 6) !== record.flags || u16(at + 8) !== record.method || u32(at + 14) !== record.crc || u32(at + 18) !== record.compressed || u32(at + 22) !== record.size || nameSize !== record.name.length || bytes.subarray(at + 30, at + 30 + nameSize).some((value, index) => value !== record.name[index])) throw new Error("Project ZIP local/central name or size identity differs");
    let data: Uint8Array;
    try { data = record.method === 0 ? bytes.slice(start, finish) : new Uint8Array(inflateRawSync(bytes.subarray(start, finish), { maxOutputLength: Math.max(1, record.size) })); }
    catch { throw new Error("Project ZIP decompression exceeds its declared budget or integrity"); }
    if (data.length !== record.size || crc32(data) !== record.crc) throw new Error("Project ZIP CRC or member integrity failed");
    output.push({ path: record.path, data }); offset = finish;
  }
  if (offset !== directory) throw new Error("Project ZIP contains unlisted bytes before its directory"); return output.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
