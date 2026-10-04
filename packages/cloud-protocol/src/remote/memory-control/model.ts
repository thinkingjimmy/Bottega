/**
 * [INPUT]: Closed encrypted-space, device, revision and packet contracts.
 * [OUTPUT]: Durable per-computer Memory intent, receipt and four scoped CAS RPC contracts.
 * [POS]: Remote Memory control protocol; no timeout, plaintext switch or first-enable authority.
 */
import { z } from "zod";
import { cloudIdSchema as id } from "../../auth";
import { encryptedSpaceSchema, encryptedBusinessHeaderSchema } from "../../spaces";
import { remotePacketSchema } from "../encrypted/model";
export const memoryControlHeaderSchema = z.object({ requestId: id, sourceDeviceId: id, targetDeviceId: id,
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), protocolVersion: z.number().int().positive() }).strict();
export const memoryControlRequestSchema = memoryControlHeaderSchema.extend({ packet: remotePacketSchema });
export const memoryControlBodySchema = z.object({ paused: z.boolean() }).strict();
export const memoryControlResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("applied"), paused: z.boolean(), appliedAt: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("refused"), code: z.enum(["facade-disabled", "memory-not-enabled", "backend-unavailable", "invalid-command"]) }).strict(),
]);
export const memoryControlReceiptSchema = z.object({ request: memoryControlRequestSchema, encryptedSpace: encryptedSpaceSchema,
  state: z.enum(["pending", "applied", "refused", "revoked"]), result: remotePacketSchema.nullable() }).strict();
export type MemoryControlRequest = z.infer<typeof memoryControlRequestSchema>;
export type MemoryControlReceipt = z.infer<typeof memoryControlReceiptSchema>;
export type MemoryControlResult = z.infer<typeof memoryControlResultSchema>;
const header = encryptedBusinessHeaderSchema.shape;
const selected = { targetDeviceId: id };
const effect = { requestId: id, revision: memoryControlHeaderSchema.shape.revision, ciphertextHash: z.string().regex(/^[a-f0-9]{64}$/), connectionEpoch: id };
export const memoryControlFunctions = {
  "remote/memory/control:submit": { kind: "mutation", args: z.object({ ...header, request: memoryControlRequestSchema }).strict(),
    result: z.object({ kind: z.enum(["submitted", "conflict"]), current: memoryControlReceiptSchema }).strict() },
  "remote/memory/control:get": { kind: "query", args: z.object({ ...header, ...selected }).strict(), result: memoryControlReceiptSchema.nullable() },
  "remote/memory/control:authorize": { kind: "mutation", args: z.object({ ...header, ...effect }).strict(), result: memoryControlReceiptSchema.nullable() },
  "remote/memory/control:settle": { kind: "mutation", args: z.object({ ...header, ...effect, state: z.enum(["applied", "refused"]), result: remotePacketSchema }).strict(), result: memoryControlReceiptSchema.nullable() },
} as const;
