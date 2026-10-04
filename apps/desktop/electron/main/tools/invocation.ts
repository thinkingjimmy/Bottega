/**
 * [INPUT]: Depends on Node crypto and the strict request digest of @ai-chat/cloud-protocol contracts
 * [OUTPUT]: Provides toolInvocationId (identity of one call intent: MCP session nonce + JSON-RPC request id + tool), toolRequestDigest (content digest that only detects "same id, different content"), and canonicalize, the locale-independent key-sorted JSON value form the coordinator's canonicalHash hashes
 * [POS]: The tools platform's identity helper; two intentional calls with identical arguments are two identities, a retransmission of one call keeps its identity
 */

import { createHash } from "node:crypto";
import { requestDigest } from "@ai-chat/cloud-protocol/contracts/canonical";

/* Code-unit order, never localeCompare: the same value must hash the same under every UI locale. */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => [key, canonicalize(item)])
  );
}

/**
 * One call intent. The nonce is minted once per MCP server process (one MCP session) and the request id is
 * the JSON-RPC id the client gave this call, unique among that session's requests; a turn on a resident
 * connection keeps the session, so ids never collide across its turns.
 */
export function toolInvocationId(sessionNonce: string, requestId: string | number, tool: string) {
  return createHash("sha256")
    .update(`bottega.tool-invocation/v2\0${sessionNonce}\0${typeof requestId}:${requestId}\0${tool}`)
    .digest("hex");
}

export function toolRequestDigest(tool: string, args: unknown) {
  return requestDigest({ tool, args: args ?? null });
}
