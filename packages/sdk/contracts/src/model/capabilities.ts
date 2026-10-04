/**
 * [INPUT]: Depends on Zod and the strict JSON value type.
 * [OUTPUT]: Provides capability-ref kinds and their wire format, registered-operation names, and the versioned RPC request/response envelopes that replace main-process closures.
 * [POS]: Serializable handle vocabulary between the host and out-of-process code (Provider bridge, Extension Host); a ref is an unguessable host-issued name, never an object, function or path.
 */
import { z } from "zod";
import type { JsonValue } from "../core/canonical";

/* The four refs the Provider bridge needs, plus `operation` for a handle to a registered operation's receipt. */
export const CAPABILITY_REF_KINDS = ["execution", "workspace", "tool-plan", "result-sink", "operation"] as const;
export type CapabilityRefKind = (typeof CAPABILITY_REF_KINDS)[number];
const REF_PATTERN = /^cap_(execution|workspace|tool-plan|result-sink|operation)_[A-Za-z0-9_-]{43}$/;
export const capabilityRefSchema = z.string().regex(REF_PATTERN);
export type CapabilityRef = z.infer<typeof capabilityRefSchema>;
export const capabilityRefOf = (kind: CapabilityRefKind) =>
  capabilityRefSchema.refine(value => value.startsWith(`cap_${kind}_`), `capability-ref-kind:${kind}`);
export function capabilityRefKind(value: string): CapabilityRefKind | null {
  const match = REF_PATTERN.exec(value);
  return match ? match[1] as CapabilityRefKind : null;
}

/** Dotted lower-case name, for example `operations.query` or `workspace.read-file`. */
export const operationNameSchema = z.string().max(96).regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/);

export const RPC_VERSION = 1 as const;
const rpcId = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const jsonValue: z.ZodType<JsonValue> = z.lazy(() => z.union([z.null(), z.boolean(), z.number(), z.string(), z.array(jsonValue), z.record(z.string(), jsonValue)]));
export const rpcRequestSchema = z.object({ v: z.literal(RPC_VERSION), id: rpcId, operation: operationNameSchema, input: jsonValue,
  refs: z.array(capabilityRefSchema).max(8).optional() }).strict();
export type RpcRequest = z.infer<typeof rpcRequestSchema>;
export const RPC_ERROR_CODES = ["invalid-request", "unknown-operation", "principal-denied", "capability-invalid", "capability-revoked",
  "input-invalid", "operation-failed", "unavailable", "cancelled"] as const;
export const rpcResponseSchema = z.discriminatedUnion("ok", [
  z.object({ v: z.literal(RPC_VERSION), id: rpcId, ok: z.literal(true), result: jsonValue }).strict(),
  z.object({ v: z.literal(RPC_VERSION), id: rpcId, ok: z.literal(false),
    error: z.object({ code: z.enum(RPC_ERROR_CODES), message: z.string().max(1024) }).strict() }).strict(),
]);
export type RpcResponse = z.infer<typeof rpcResponseSchema>;
