/**
 * [INPUT]: Depends on shared built-in tool wire Budget/tool name; The result of the single logical return of the bridge
 * [OUTPUT]: Provides toBuiltinCallToolResult, which validates the initiator cap after final MCP serialization and adapts either one text payload or one text-plus-image payload without structuredContent duplication
 * [POS]: The final gateway to the tools platform; prevents content/structuredContent duplication and keeps image base64 out of the text copy
 */

import {
  BUILTIN_WIRE_BYTE_LIMIT,
  type BuiltinToolName,
} from "../../../shared/builtin-tools";

type BuiltinImageResult = Readonly<{
  type: "builtin-image";
  mimeType: "image/jpeg" | "image/png";
  data: string;
  metadata: unknown;
}>;

const isImageResult = (value: unknown): value is BuiltinImageResult => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.type === "builtin-image" &&
    (record.mimeType === "image/jpeg" || record.mimeType === "image/png") &&
    typeof record.data === "string" &&
    record.data.length > 0 &&
    record.data.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(record.data);
};

const resultOf = (value: unknown) => isImageResult(value)
  ? {
      content: [
        { type: "text" as const, text: JSON.stringify(value.metadata) },
        { type: "image" as const, data: value.data, mimeType: value.mimeType },
      ],
    }
  : { content: [{ type: "text" as const, text: JSON.stringify(value) }] };

export const builtinCallToolResultBytes = (value: unknown) =>
  Buffer.byteLength(JSON.stringify(resultOf(value)), "utf8");

function utf8Prefix(value: string, byteLimit: number) {
  const bytes = Buffer.from(value, "utf8");
  let end = Math.min(byteLimit, bytes.byteLength);
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString("utf8");
}

function truncateField(
  value: unknown,
  field: "result" | "transcript",
  limit: number
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const text = record[field];
  if (typeof text !== "string") return value;
  let low = 0;
  let high = Buffer.byteLength(text, "utf8");
  let best = "";
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = utf8Prefix(text, middle);
    const next = { ...record, [field]: `${candidate}…[已截断]` };
    if (builtinCallToolResultBytes(next) <= limit) {
      best = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return { ...record, [field]: `${best}…[已截断]` };
}

export function toBuiltinCallToolResult(
  value: unknown,
  limit = BUILTIN_WIRE_BYTE_LIMIT,
  tool?: BuiltinToolName
) {
  let safe = value;
  if (
    builtinCallToolResultBytes(safe) > limit &&
    tool === "spawn_subagent"
  ) {
    safe = truncateField(safe, "result", limit);
  }
  if (
    builtinCallToolResultBytes(safe) > limit &&
    tool === "read_section"
  ) {
    safe = truncateField(safe, "transcript", limit);
  }
  const result = resultOf(safe);
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > limit) {
    throw Object.assign(
      new Error(`内置 MCP CallToolResult 超过 ${limit} 字节 wire 预算`),
      { status: 413 }
    );
  }
  return result;
}
