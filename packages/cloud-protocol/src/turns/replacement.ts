/**
 * [INPUT]: Depends on closed live projection content, bounded fragment contracts and exact content hashing.
 * [OUTPUT]: Encodes immutable replacement frames and applies them only after complete byte/hash/schema validation.
 * [POS]: Shared replay transaction; incomplete frames preserve the previously visible projection.
 */
import { canonicalJson } from "../encryption/encoding";
import { hashBytes } from "../blobs/transfer";
import { utf8Length } from "../chats/content/parts";
import { truncateUtf8 } from "./text/truncate-utf8";
import { LIVE_TURN_LIMITS, liveProjectionContentSchema, type LiveProjection, type LiveEvent } from "./live";
export function* replacementEvents(snapshotId: string, value: LiveProjection): Generator<LiveEvent> {
  const { replacement: _pending, ...projection } = value;
  const content = canonicalJson(liveProjectionContentSchema.parse(projection)), bytes = new TextEncoder().encode(content);
  if (bytes.length > LIVE_TURN_LIMITS.projectionBytes) throw new Error("LIVE_REPLACEMENT_BUDGET");
  yield { type: "replacement-begin", snapshotId, bytes: bytes.length, sha256: hashBytes(bytes) };
  let index = 0;
  for (let offset = 0; offset < content.length;) {
    const text = truncateUtf8(content.slice(offset), 16 * 1024).value;
    yield { type: "replacement-part", snapshotId, index: index++, text }; offset += text.length;
  }
  yield { type: "replacement-commit", snapshotId };
}
export function reduceReplacement(state: LiveProjection, event: Extract<LiveEvent, { type: "replacement-begin" | "replacement-part" | "replacement-commit" | "replacement-abort" }>): LiveProjection {
  if (event.type === "replacement-begin") return { ...state, replacement: { snapshotId: event.snapshotId, sha256: event.sha256, bytes: event.bytes, receivedBytes: 0, parts: [] } };
  const pending = state.replacement;
  if (!pending || pending.snapshotId !== event.snapshotId) throw new Error("LIVE_REPLACEMENT_IDENTITY_CHANGED");
  if (event.type === "replacement-abort") { const { replacement: _pending, ...visible } = state; return visible; }
  if (event.type === "replacement-part") {
    const receivedBytes = pending.receivedBytes + utf8Length(event.text);
    if (event.index !== pending.parts.length || receivedBytes > pending.bytes || pending.parts.length >= 512) throw new Error("LIVE_REPLACEMENT_PART_INVALID");
    return { ...state, replacement: { ...pending, receivedBytes, parts: [...pending.parts, event.text] } };
  }
  const content = pending.parts.join(""), bytes = new TextEncoder().encode(content);
  if (bytes.length !== pending.bytes || pending.receivedBytes !== pending.bytes || hashBytes(bytes) !== pending.sha256) throw new Error("LIVE_REPLACEMENT_INCOMPLETE");
  const projection = liveProjectionContentSchema.parse(JSON.parse(content));
  if (canonicalJson(projection) !== content) throw new Error("LIVE_REPLACEMENT_NONCANONICAL");
  return projection;
}
