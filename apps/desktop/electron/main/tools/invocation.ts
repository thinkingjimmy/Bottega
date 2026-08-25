/**
 * [INPUT]: Depends on Node crypto, built-in MCP tool names and JSON parameters
 * [OUTPUT]: Provides stableToolInvocationId, generates a reconstructed stable key by canonical parameter hash
 * [POS]: The tools platform's silicon-based values; SDK as a downgrade key when the tool-call id is not exposed
 */

import { createHash } from "node:crypto";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)])
  );
}

export function stableToolInvocationId(tool: string, args: unknown) {
  return createHash("sha256")
    .update(`${tool}\0${JSON.stringify(canonicalize(args))}`)
    .digest("hex");
}
