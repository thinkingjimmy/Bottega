/**
 * [INPUT]: Bounded plugin source contracts and binary typed-array values.
 * [OUTPUT]: Explicit binary-preserving codec, integrity checks and opaque source creation.
 * [POS]: Shared plugin source and compute serialization; decoding is an editor concern.
 */
import { PLUGIN_SOURCE_BYTES, pluginSourceSchema, type PluginSource, type PluginSourceMetadata } from '@bottega/contracts/plugins/surface/source';
export { pluginSourceEditable } from '@bottega/contracts/plugins/surface/source';
export function toBase64(bytes: Uint8Array): string {
  let value = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) value += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(value);
}
export function fromBase64(value: string): Uint8Array {
  const result = Uint8Array.from(atob(value), c => c.charCodeAt(0));
  if (toBase64(result) !== value) throw new Error('PLUGIN_SOURCE_INVALID');
  return result;
}
export async function digestPluginBytes(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
const arrays = { Float64Array, Float32Array, Int32Array, Uint32Array, Int16Array, Uint16Array, Int8Array, Uint8Array, Uint8ClampedArray };
const MAGIC = new TextEncoder().encode("BTPVAL01");
/** JSON contains structure only; raw buffers avoid a base64 expansion of the 16 MiB source budget. */
export function encodePluginValue(value: unknown): Uint8Array {
  const buffers: Uint8Array[] = [];
  const json = JSON.stringify(value, (_key, item: unknown) => {
    if (!ArrayBuffer.isView(item)) return item;
    const type = item.constructor.name;
    if (!Object.hasOwn(arrays, type)) throw new Error('PLUGIN_SOURCE_INVALID');
    const index = buffers.length;
    buffers.push(new Uint8Array(item.buffer, item.byteOffset, item.byteLength));
    return { $pluginBinary: type, index };
  });
  if (json === undefined) throw new Error('PLUGIN_SOURCE_INVALID');
  const header = new TextEncoder().encode(json);
  const size = 16 + header.length + buffers.reduce((total, bytes) => total + 4 + bytes.length, 0);
  if (size > PLUGIN_SOURCE_BYTES || buffers.length > 65536) throw new Error('PLUGIN_SOURCE_LIMIT');
  const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
  bytes.set(MAGIC); view.setUint32(8, header.length, true); view.setUint32(12, buffers.length, true);
  bytes.set(header, 16); let offset = 16 + header.length;
  for (const buffer of buffers) { view.setUint32(offset, buffer.length, true); offset += 4; bytes.set(buffer, offset); offset += buffer.length; }
  return bytes;
}
export function decodePluginValue(bytes: Uint8Array): unknown {
  if (bytes.length < 16 || bytes.length > PLUGIN_SOURCE_BYTES || !MAGIC.every((byte, i) => byte === bytes[i])) throw new Error('PLUGIN_SOURCE_INVALID');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), length = view.getUint32(8, true), count = view.getUint32(12, true);
  if (length > bytes.length - 16 || count > 65536) throw new Error('PLUGIN_SOURCE_INVALID');
  const buffers: Uint8Array[] = []; let offset = 16 + length;
  for (let i = 0; i < count; i++) {
    if (offset + 4 > bytes.length) throw new Error('PLUGIN_SOURCE_INVALID');
    const size = view.getUint32(offset, true); offset += 4;
    if (offset + size > bytes.length) throw new Error('PLUGIN_SOURCE_INVALID');
    buffers.push(bytes.slice(offset, offset + size)); offset += size;
  }
  if (offset !== bytes.length) throw new Error('PLUGIN_SOURCE_INVALID');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(16, 16 + length)), (_key, item: unknown) => {
    if (!item || typeof item !== 'object' || !('$pluginBinary' in item)) return item;
    const binary = item as { $pluginBinary: string; index: number };
    if (Object.keys(binary).length !== 2 || !Object.hasOwn(arrays, binary.$pluginBinary) || !Number.isInteger(binary.index)) throw new Error('PLUGIN_SOURCE_INVALID');
    const ctor = arrays[binary.$pluginBinary as keyof typeof arrays], data = buffers[binary.index];
    if (!data || data.byteLength % ctor.BYTES_PER_ELEMENT) throw new Error('PLUGIN_SOURCE_INVALID');
    return new ctor(data.buffer as ArrayBuffer);
  });
}
export async function makePluginSource(identity: Pick<PluginSourceMetadata, 'pluginId' | 'generationId' | 'format'>, bytes: Uint8Array): Promise<PluginSource> {
  return pluginSourceSchema.parse({ ...identity, byteLength: bytes.length, sha256: await digestPluginBytes(bytes), encoding: 'base64', bytes: toBase64(bytes) });
}
export async function verifyPluginSource(source: PluginSource): Promise<Uint8Array> {
  const checked = pluginSourceSchema.parse(source), bytes = fromBase64(checked.bytes);
  if (bytes.length !== checked.byteLength || await digestPluginBytes(bytes) !== checked.sha256) throw new Error('PLUGIN_SOURCE_INTEGRITY');
  return bytes;
}
