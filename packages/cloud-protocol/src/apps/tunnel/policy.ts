/**
 * [INPUT]: Decrypted HTTP envelopes and application-owned origin facts.
 * [OUTPUT]: Strict request normalization, bounded binary envelopes and response restrictions.
 * [POS]: S7 policy shared by the isolated worker and the loopback endpoint.
 */
import { TUNNEL_LIMITS } from "./model";
const forbiddenPathCharacter = (path: string) => [...path].some(char => char === "\\" || char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127);
const encoder = new TextEncoder(), decoder = new TextDecoder("utf-8", { fatal: true });
export type TunnelHttp = { method?: string; path?: string; status?: number; headers: Record<string, string>; body: Uint8Array };
export function tunnelPath(path: string) {
  if (!path.startsWith("/") || path.startsWith("//") || forbiddenPathCharacter(path) || /%(2f|5c|00|0a|0d)/i.test(path)) throw new Error("tunnel-path-denied");
  const pathname = path.split("?")[0]!;
  let decoded: string; try { decoded = decodeURIComponent(pathname); } catch { throw new Error("tunnel-path-denied"); }
  if (decoded.split("/").some(part => part === "." || part === "..") || forbiddenPathCharacter(decoded) || /%[0-9a-f]{2}/i.test(decoded)) throw new Error("tunnel-path-denied");
  return path;
}
export function requestPolicy(value: TunnelHttp, origin: string) {
  if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(value.method ?? "") || !value.path || value.body.length > TUNNEL_LIMITS.request) throw new Error("tunnel-request-denied");
  tunnelPath(value.path);
  const allowed = new Set(["accept", "accept-language", "content-type", "if-none-match", "if-modified-since", "range"]);
  const headers: Record<string, string> = { origin, referer: origin + "/" };
  if (value.headers["x-tunnel-cookie"]) headers.cookie = value.headers["x-tunnel-cookie"];
  for (const [name, content] of Object.entries(value.headers)) if (allowed.has(name.toLowerCase())) headers[name.toLowerCase()] = content;
  return { method: value.method!, path: value.path, headers, body: value.body };
}
export function responsePolicy(value: TunnelHttp) {
  if (!value.status || value.status < 100 || value.status > 599 || value.body.length > TUNNEL_LIMITS.response) throw new Error("tunnel-response-denied");
  if (value.status >= 300 && value.status < 400 && value.headers.location) tunnelPath(value.headers.location);
  if ((value.headers["content-type"] ?? "").includes("text/event-stream")) throw new Error("tunnel-streaming-unsupported");
  return value;
}
export function packHttp(value: TunnelHttp) {
  const { body, ...metadata } = value, header = encoder.encode(JSON.stringify(metadata));
  if (header.length > 32_768) throw new Error("tunnel-headers-limit");
  const out = new Uint8Array(4 + header.length + body.length); new DataView(out.buffer).setUint32(0, header.length); out.set(header, 4); out.set(body, 4 + header.length); return out;
}
export function unpackHttp(bytes: Uint8Array): TunnelHttp {
  if (bytes.length < 4) throw new Error("tunnel-envelope-invalid");
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (length > 32_768 || length + 4 > bytes.length) throw new Error("tunnel-envelope-invalid");
  const value = JSON.parse(decoder.decode(bytes.subarray(4, 4 + length)));
  if (!value || typeof value !== "object" || !value.headers || Object.getPrototypeOf(value.headers) !== Object.prototype ||
    Object.keys(value.headers).length > 100 || Object.entries(value.headers).some(([k,v]) => !/^[a-z0-9-]+$/i.test(k) || typeof v !== "string" || /[\r\n]/.test(v as string))) throw new Error("tunnel-envelope-invalid");
  if (value.method !== undefined && typeof value.method !== "string" || value.path !== undefined && typeof value.path !== "string" ||
    value.status !== undefined && !Number.isInteger(value.status)) throw new Error("tunnel-envelope-invalid");
  return { ...value, body: bytes.slice(4 + length) };
}
