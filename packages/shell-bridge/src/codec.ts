/**
 * [INPUT]: Depends on ./contract for the closed method, event and error sets and the wire limits.
 * [OUTPUT]: Provides encodeMessage, decodePageMessage (host side), decodeShellMessage (page side) and per-method params/result/event validators.
 * [POS]: The only parser of bridge text; client.ts and host.ts never trust a message this module did not accept.
 */
import {
  SHELL_LIMITS, shellErrorCodes, shellEventNames, shellMethodCapability,
  type PageToShellMessage, type ShellEventName, type ShellMethod, type ShellToPageMessage,
} from "./contract";

type Guard = (value: unknown) => boolean;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const exact = (value: unknown, keys: Record<string, Guard>, optional: Record<string, Guard> = {}) => {
  if (!record(value)) return false;
  for (const key of Object.keys(value)) if (!(key in keys) && !(key in optional)) return false;
  for (const [key, guard] of Object.entries(keys)) if (!guard(value[key])) return false;
  for (const [key, guard] of Object.entries(optional)) if (key in value && !guard(value[key])) return false;
  return true;
};
const text = (max: number, min = 1): Guard => value => typeof value === "string" && value.length >= min && value.length <= max;
const id = text(128);
const int = (min: number, max: number): Guard => value => Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
const bool: Guard = value => typeof value === "boolean";
const oneOf = (items: readonly string[]): Guard => value => typeof value === "string" && items.includes(value);
const nothing: Guard = value => exact(value, {});
const isNull: Guard = value => value === null;
const base64 = (max: number): Guard => value => typeof value === "string" && value.length <= max && /^[A-Za-z0-9+/]*={0,2}$/.test(value);
const httpUrl: Guard = value => {
  if (typeof value !== "string" || value.length > 4096) return false;
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:"; } catch { return false; }
};
/* Wrapped key material and AAD are UTF-8 JSON/base64 text of a few hundred bytes; the bound stays generous. */
const material = text(16_384);
const pushTap: Guard = value => exact(value, { tapId: id, chatId: id, kind: oneOf(["settled", "attention"]) }, { turnSeq: int(0, Number.MAX_SAFE_INTEGER) });
const visibleChat: Guard = value => value === null || exact(value, { chatId: id, generation: int(0, Number.MAX_SAFE_INTEGER) });
const chunkChars = Math.ceil(SHELL_LIMITS.fileChunkBytes / 3) * 4;

export const paramGuards: Readonly<Record<ShellMethod, Guard>> = Object.freeze({
  "auth.signIn": nothing, "auth.clear": nothing,
  "secure.wrap": value => exact(value, { plaintext: material, aad: material, requireAuthentication: bool }),
  "secure.unwrap": value => exact(value, { keyRef: id, ciphertext: material, nonce: text(256), aad: material }),
  "secure.remove": value => exact(value, { keyRef: id }),
  "biometrics.capability": nothing,
  "push.register": nothing, "push.clear": nothing,
  "push.setVisibleChat": value => exact(value, { chat: visibleChat }),
  "push.subscribe": nothing,
  "push.ack": value => exact(value, { tapId: id }),
  "files.begin": value => exact(value, { name: text(255), mime: text(255), size: int(0, SHELL_LIMITS.maxFileBytes), action: oneOf(["save", "share"]) }),
  "files.chunk": value => exact(value, { transferId: id, index: int(0, 1_000_000), data: base64(chunkChars) }),
  "files.commit": value => exact(value, { transferId: id }),
  "files.cancel": value => exact(value, { transferId: id }),
  "links.openExternal": value => exact(value, { url: httpUrl, purpose: oneOf(["artifact", "web-context", "preview-session"]) }),
  "network.state": nothing,
  "lifecycle.backResult": value => exact(value, { backId: id, consumed: bool }),
  "lifecycle.ready": nothing,
});

export const resultGuards: Readonly<Record<ShellMethod, Guard>> = Object.freeze({
  "auth.signIn": value => exact(value, { idToken: text(8192) }) || exact(value, { cancelled: value => value === true }),
  "auth.clear": isNull,
  "secure.wrap": value => exact(value, { keyRef: id, ciphertext: material, nonce: text(256) }),
  "secure.unwrap": value => exact(value, { plaintext: material }),
  "secure.remove": isNull,
  "biometrics.capability": value => exact(value, { capability: oneOf(["none", "available", "enrolled"]) }),
  "push.register": value => exact(value, { token: value => value === null || text(4096)(value) }),
  "push.clear": isNull, "push.setVisibleChat": isNull,
  "push.subscribe": value => exact(value, { pending: value => Array.isArray(value) && value.length <= 32 && value.every(pushTap) }),
  "push.ack": isNull,
  "files.begin": value => exact(value, { transferId: id }),
  "files.chunk": isNull, "files.commit": isNull, "files.cancel": isNull,
  "links.openExternal": isNull,
  "network.state": value => exact(value, { state: oneOf(["online", "offline", "unknown"]) }),
  "lifecycle.backResult": isNull, "lifecycle.ready": isNull,
});

export const eventGuards: Readonly<Record<ShellEventName, Guard>> = Object.freeze({
  "lifecycle.foreground": nothing, "lifecycle.background": nothing,
  "lifecycle.back": value => exact(value, { backId: id }),
  "push.opened": pushTap, "push.tokenChanged": nothing,
  "network.change": value => exact(value, { state: oneOf(["online", "offline"]) }),
});

export function encodeMessage(message: PageToShellMessage | ShellToPageMessage): string {
  const encoded = JSON.stringify(message);
  if (encoded.length > SHELL_LIMITS.maxMessageBytes) throw new Error("shell-message-too-large");
  return encoded;
}

function parse(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string" || raw.length > SHELL_LIMITS.maxMessageBytes) return null;
  try { const value: unknown = JSON.parse(raw); return record(value) && value.v === 1 ? value : null; } catch { return null; }
}

/** Host side: a request whose method is known and whose params match; anything else is null. */
export function decodePageMessage(raw: unknown): PageToShellMessage | null {
  const value = parse(raw);
  if (!value) return null;
  const generation = int(0, Number.MAX_SAFE_INTEGER);
  if (value.kind === "cancel") return exact(value, { v: () => true, kind: () => true, id, generation }) ? value as PageToShellMessage : null;
  if (value.kind !== "request" || !exact(value, { v: () => true, kind: () => true, id, generation, method: oneOf(Object.keys(shellMethodCapability)), params: () => true })) return null;
  return paramGuards[value.method as ShellMethod](value.params) ? value as PageToShellMessage : null;
}

/** Page side: response envelopes (result checked by the caller that knows the method) and known events. */
export function decodeShellMessage(raw: unknown): ShellToPageMessage | null {
  const value = parse(raw);
  if (!value) return null;
  if (value.kind === "event") {
    if (!exact(value, { v: () => true, kind: () => true, name: oneOf(shellEventNames), payload: () => true })) return null;
    return eventGuards[value.name as ShellEventName](value.payload) ? value as ShellToPageMessage : null;
  }
  if (value.kind !== "response") return null;
  const envelope = { v: () => true, kind: () => true, id };
  const error: Guard = item => exact(item, { code: oneOf(shellErrorCodes), message: text(512, 0) });
  if (value.ok === true && exact(value, { ...envelope, ok: bool, result: () => true })) return value as ShellToPageMessage;
  if (value.ok === false && exact(value, { ...envelope, ok: bool, error })) return value as ShellToPageMessage;
  return null;
}
