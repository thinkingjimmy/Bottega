/**
 * [INPUT]: Depends on bounded ZIP bytes, reviewed member names and Node's bounded raw inflater
 * [OUTPUT]: Provides exact-member extraction after central/local agreement, CRC and cumulative budget checks
 * [POS]: Memory Windows uv archive boundary; never writes archive-controlled paths to disk
 */

import { inflateRawSync } from "node:zlib";
import { UV_ARCHIVE_BYTES, UV_EXPANDED_BYTES, WINDOWS_UV_MEMBERS } from "./uv-assets";

export function extractUvFromZip(archive: Buffer): Buffer {
  return extractZipMembers(archive, WINDOWS_UV_MEMBERS).get("uv.exe")!;
}

export function extractZipMembers(archive: Buffer, members: readonly string[], maximum = UV_EXPANDED_BYTES) {
  if (archive.length < 22 || archive.length > UV_ARCHIVE_BYTES) throw invalid("archive size");
  const end = archive.length - 22;
  if (archive.readUInt32LE(end) !== 0x06054b50 || archive.readUInt32LE(end + 4) !== 0 || archive.readUInt16LE(end + 20) !== 0) throw invalid("end record");
  const count = archive.readUInt16LE(end + 10);
  const directoryBytes = archive.readUInt32LE(end + 12);
  const directory = archive.readUInt32LE(end + 16);
  if (count !== members.length || archive.readUInt16LE(end + 8) !== count || directory + directoryBytes !== end) throw invalid("directory");
  let offset = directory;
  let expanded = 0;
  let nextLocal = 0;
  const output = new Map<string, Buffer>();
  for (let index = 0; index < count; index++) {
    const entry = centralEntry(archive, offset, end);
    offset = entry.end;
    if (!members.includes(entry.name) || output.has(entry.name) || [...output.keys()].some((name) => name.toLowerCase() === entry.name.toLowerCase())) throw invalid("member");
    expanded += entry.size;
    if (expanded > maximum || entry.size === 0) throw invalid("expanded budget");
    if (entry.local !== nextLocal) throw invalid("overlapping or missing local entry");
    const body = localEntry(archive, entry, directory);
    nextLocal = body.end;
    const bytes = entry.method === 0 ? Buffer.from(body.bytes) : inflateRawSync(body.bytes, { maxOutputLength: entry.size });
    if (bytes.length !== entry.size || crc32(bytes) !== entry.crc) throw invalid("content checksum");
    output.set(entry.name, bytes);
  }
  if (offset !== end || nextLocal !== directory || output.size !== members.length) throw invalid("trailing bytes");
  return output;
}

function centralEntry(bytes: Buffer, offset: number, end: number) {
  if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) throw invalid("central header");
  const nameLength = bytes.readUInt16LE(offset + 28);
  const extraLength = bytes.readUInt16LE(offset + 30);
  const commentLength = bytes.readUInt16LE(offset + 32);
  const next = offset + 46 + nameLength + extraLength + commentLength;
  if (next > end || commentLength || bytes.readUInt16LE(offset + 34)) throw invalid("central fields");
  const flags = bytes.readUInt16LE(offset + 8);
  const method = bytes.readUInt16LE(offset + 10);
  const attributes = bytes.readUInt32LE(offset + 38);
  const mode = (attributes >>> 16) & 0xf000;
  if (bytes.readUInt16LE(offset + 6) > 20 || flags & ~0x800 || ![0, 8].includes(method) ||
      (mode !== 0 && mode !== 0x8000) || (attributes & 0x410)) throw invalid("unsupported member type");
  const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw invalid("member path");
  assertTimestampExtras(bytes.subarray(offset + 46 + nameLength, offset + 46 + nameLength + extraLength));
  return { name, end: next, flags, method, crc: bytes.readUInt32LE(offset + 16),
    compressed: bytes.readUInt32LE(offset + 20), size: bytes.readUInt32LE(offset + 24), local: bytes.readUInt32LE(offset + 42) };
}

function localEntry(bytes: Buffer, entry: ReturnType<typeof centralEntry>, directory: number) {
  const offset = entry.local;
  if (offset + 30 > directory || bytes.readUInt32LE(offset) !== 0x04034b50) throw invalid("local header");
  const nameLength = bytes.readUInt16LE(offset + 26);
  const extraLength = bytes.readUInt16LE(offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  const end = start + entry.compressed;
  if (end > directory || bytes.readUInt16LE(offset + 4) > 20 || bytes.readUInt16LE(offset + 6) !== entry.flags ||
      bytes.readUInt16LE(offset + 8) !== entry.method || bytes.readUInt32LE(offset + 14) !== entry.crc ||
      bytes.readUInt32LE(offset + 18) !== entry.compressed || bytes.readUInt32LE(offset + 22) !== entry.size ||
      bytes.subarray(offset + 30, offset + 30 + nameLength).toString("utf8") !== entry.name) throw invalid("local/central mismatch");
  assertTimestampExtras(bytes.subarray(offset + 30 + nameLength, start));
  return { bytes: bytes.subarray(start, end), end };
}

function assertTimestampExtras(bytes: Buffer) {
  for (let offset = 0; offset < bytes.length;) {
    if (offset + 4 > bytes.length || bytes.readUInt16LE(offset) !== 0x000a) throw invalid("extra field");
    offset += 4 + bytes.readUInt16LE(offset + 2);
    if (offset > bytes.length) throw invalid("truncated extra field");
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
export function crc32(bytes: Buffer) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function invalid(reason: string) { return new Error(`Unsafe uv ZIP: ${reason}`); }
