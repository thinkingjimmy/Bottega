/**
 * [INPUT]: Depends on closed portable options, execution identities and canonical hashing.
 * [OUTPUT]: Defines immutable owner option changes and receipt-backed causal outcomes.
 * [POS]: Dedicated execution-facts contract; ordinary metadata cannot write Agent options.
 */
import { z } from "zod";
import { cloudIdSchema as id } from "../auth";
import { canonicalJson } from "../encryption/encoding";
import { versionSchema as rev } from "../scalars";
import { hashBytes } from "../blobs/transfer";
import { turnOptionsSchema } from "./options";
export const chatOptionsOperationSchema = z.object({ operationId: id, chatId: id, incarnationId: id,
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/), agentRevision: rev,
  afterUserSeq: rev, previous: turnOptionsSchema, options: turnOptionsSchema,
}).strict().refine(value => value.previous.backend === value.options.backend, "Agent changes require a turn notice");
export type ChatOptionsOperation = z.infer<typeof chatOptionsOperationSchema>;
export const chatOptionsReceiptSchema = z.object({ operationId: id, chatId: id, payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["applied", "converged", "superseded", "conflicted", "fenced", "deleted"]), sourceDeviceId: id, createdAt: rev,
}).strict();
export function hashChatOptionsOperation(input: ChatOptionsOperation) {
  const { payloadHash: _hash, ...value } = chatOptionsOperationSchema.parse(input);
  return hashBytes(new TextEncoder().encode(canonicalJson(value)));
}
