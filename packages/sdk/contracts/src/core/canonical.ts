/**
 * [INPUT]: Depends on the protocol canonicalJson/hashCanonical encoding boundary and fatal UTF-8 decoding.
 * [OUTPUT]: Provides bounded strict JSON parsing with raw-text duplicate-key detection, strict canonical JSON, `sha256:` request digests and the closed CanonicalJsonError codes.
 * [POS]: The one cross-party digest rule for public operation contracts; accepted values always canonicalize exactly like encryption/encoding.ts, so digests agree with existing operation ids.
 */
import { canonicalJson, hashCanonical } from "./canonical-json";

export const CANONICAL_JSON_LIMITS = Object.freeze({ maxBytes: 1_048_576, maxDepth: 32, maxNodes: 100_000 });
export type CanonicalJsonLimits = Readonly<{ maxBytes: number; maxDepth: number; maxNodes: number }>;
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export const CANONICAL_JSON_ERRORS = ["canonical-too-large", "canonical-too-deep", "canonical-too-many-nodes", "canonical-invalid-json",
  "canonical-invalid-utf8", "canonical-duplicate-key", "canonical-dangerous-key", "canonical-non-finite", "canonical-unsafe-integer",
  "canonical-lone-surrogate", "canonical-unsupported-type", "canonical-non-plain-object", "canonical-accessor", "canonical-sparse-array"] as const;
export type CanonicalJsonErrorCode = (typeof CANONICAL_JSON_ERRORS)[number];
export class CanonicalJsonError extends Error {
  readonly name = "CanonicalJsonError";
  constructor(readonly code: CanonicalJsonErrorCode) { super(code); }
}
const fail = (code: CanonicalJsonErrorCode): never => { throw new CanonicalJsonError(code); };

/* `__proto__` is the one key whose assignment changes an object's prototype instead of adding data. */
const DANGEROUS_KEYS = new Set(["__proto__"]);
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();

/* ============================================================
 * Strict parse: duplicate keys only exist in raw text — once
 * JSON.parse has built an object the earlier value is gone —
 * so the scan walks the text itself. Scalars still go through
 * JSON.parse on their exact token for standard escape handling.
 * ============================================================ */
export function parseStrictJson(input: string | Uint8Array, limits: CanonicalJsonLimits = CANONICAL_JSON_LIMITS): JsonValue {
  let text: string;
  if (typeof input === "string") {
    if (encoder.encode(input).byteLength > limits.maxBytes) fail("canonical-too-large");
    text = input;
  } else {
    if (input.byteLength > limits.maxBytes) fail("canonical-too-large");
    try { text = decoder.decode(input); } catch { return fail("canonical-invalid-utf8"); }
  }
  let index = 0, nodes = 0;
  const whitespace = () => { while (index < text.length && " \t\n\r".includes(text[index]!)) index++; };
  const stringToken = (): string => {
    const start = index++;
    while (index < text.length && text[index] !== "\"") index += text[index] === "\\" ? 2 : 1;
    if (index >= text.length) fail("canonical-invalid-json");
    const raw = text.slice(start, ++index);
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return fail("canonical-invalid-json"); }
    if (LONE_SURROGATE.test(value as string)) fail("canonical-lone-surrogate");
    return value as string;
  };
  const value = (depth: number): JsonValue => {
    if (depth > limits.maxDepth) fail("canonical-too-deep");
    if (++nodes > limits.maxNodes) fail("canonical-too-many-nodes");
    whitespace();
    const char = text[index];
    if (char === "{") {
      index++;
      const result: Record<string, JsonValue> = {};
      const seen = new Set<string>();
      whitespace();
      if (text[index] === "}") { index++; return result; }
      for (;;) {
        whitespace();
        if (text[index] !== "\"") fail("canonical-invalid-json");
        const key = stringToken();
        if (DANGEROUS_KEYS.has(key)) fail("canonical-dangerous-key");
        if (seen.has(key)) fail("canonical-duplicate-key");
        seen.add(key);
        whitespace();
        if (text[index++] !== ":") fail("canonical-invalid-json");
        result[key] = value(depth + 1);
        whitespace();
        const next = text[index++];
        if (next === "}") return result;
        if (next !== ",") fail("canonical-invalid-json");
      }
    }
    if (char === "[") {
      index++;
      const result: JsonValue[] = [];
      whitespace();
      if (text[index] === "]") { index++; return result; }
      for (;;) {
        result.push(value(depth + 1));
        whitespace();
        const next = text[index++];
        if (next === "]") return result;
        if (next !== ",") fail("canonical-invalid-json");
      }
    }
    if (char === "\"") return stringToken();
    const match = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(index, index + 400));
    if (!match) return fail("canonical-invalid-json");
    index += match[0].length;
    const scalar = JSON.parse(match[0]) as JsonValue;
    if (typeof scalar === "number") number(scalar, match[0]);
    return scalar;
  };
  const result = value(0);
  whitespace();
  if (index !== text.length) fail("canonical-invalid-json");
  return result;
}

/* A value built in code is an exact double that stringifies deterministically; only an integer literal in text
   can silently lose digits on parse, so the safe-integer rule applies to parsed text alone. */
function number(value: number, literal?: string) {
  if (!Number.isFinite(value)) fail("canonical-non-finite");
  if (Object.is(value, -0)) fail("canonical-non-finite");
  if (literal && /^-?[0-9]+$/.test(literal) && !Number.isSafeInteger(value)) fail("canonical-unsafe-integer");
}

/* ============================================================
 * Strict canonical form: validates a value built in code, then
 * delegates to the protocol canonicalJson. Keys sort by UTF-16
 * code unit (RFC 8785), never by locale.
 * ============================================================ */
export function assertStrictJson(input: unknown, limits: CanonicalJsonLimits = CANONICAL_JSON_LIMITS): asserts input is JsonValue {
  let nodes = 0;
  const visit = (value: unknown, depth: number) => {
    if (depth > limits.maxDepth) fail("canonical-too-deep");
    if (++nodes > limits.maxNodes) fail("canonical-too-many-nodes");
    if (value === null || typeof value === "boolean") return;
    if (typeof value === "number") return number(value);
    if (typeof value === "string") { if (LONE_SURROGATE.test(value)) fail("canonical-lone-surrogate"); return; }
    if (typeof value !== "object") return fail("canonical-unsupported-type");
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) fail("canonical-non-plain-object");
      for (let i = 0; i < value.length; i++) {
        if (!Object.prototype.hasOwnProperty.call(value, i)) fail("canonical-sparse-array");
        visit(value[i], depth + 1);
      }
      return;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail("canonical-non-plain-object");
    if (Object.getOwnPropertySymbols(value).length) fail("canonical-unsupported-type");
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!("value" in descriptor)) fail("canonical-accessor");
      if (DANGEROUS_KEYS.has(key)) fail("canonical-dangerous-key");
      if (LONE_SURROGATE.test(key)) fail("canonical-lone-surrogate");
      if (descriptor.value === undefined) fail("canonical-unsupported-type");
      visit(descriptor.value, depth + 1);
    }
  };
  visit(input, 0);
}

export function strictCanonicalJson(value: unknown, limits: CanonicalJsonLimits = CANONICAL_JSON_LIMITS): string {
  assertStrictJson(value, limits);
  const text = canonicalJson(value);
  if (encoder.encode(text).byteLength > limits.maxBytes) fail("canonical-too-large");
  return text;
}

/** `sha256:` + hex over the strict canonical form; equal to `hashCanonical` for every accepted value. */
export function requestDigest(value: unknown, limits: CanonicalJsonLimits = CANONICAL_JSON_LIMITS): `sha256:${string}` {
  strictCanonicalJson(value, limits);
  return `sha256:${hashCanonical(value)}`;
}

/** Digest of untrusted wire text: duplicate keys and every other ambiguity are rejected before hashing. */
export function requestDigestOfText(text: string | Uint8Array, limits: CanonicalJsonLimits = CANONICAL_JSON_LIMITS) {
  return requestDigest(parseStrictJson(text, limits), limits);
}
