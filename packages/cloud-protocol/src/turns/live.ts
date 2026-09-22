/**
 * [INPUT]: Depends on closed portable items, product failures and draft part grammars.
 * [OUTPUT]: Provides safe live events with exact remote approval decisions, replacement staging, projections and bounded chunk identities.
 * [POS]: Shared network boundary excludes backend sessions, local paths, grants and Skill receipts.
 */
import { z } from "zod";
import { interactionSourceSchema, remoteApprovalDecisionSchema } from "../remote/model";
import { versionSchema as rev } from "../scalars";
import { sha256Schema } from "../blobs";
import { hashChatContent } from "../chats/transcript/body";
import { createToolPartSchema, textPartSchema, subagentPartSchema, utf8Length } from "../chats/content/parts";
import { MESSAGE_BYTE_LIMIT, TOOL_DETAIL_BYTE_LIMIT, PART_TITLE_CHAR_LIMIT, MESSAGE_PART_LIMIT, SUBAGENT_DRAFT_LIMIT } from "../chats/content/budgets";
import { agentTurnItemSchema, liveSubagentMetaSchema } from "./items";
const itemId = z.string().min(1).max(256), text = z.string().refine(value => utf8Length(value) <= MESSAGE_BYTE_LIMIT);
const draftPart = z.discriminatedUnion("type", [textPartSchema,
  createToolPartSchema(TOOL_DETAIL_BYTE_LIMIT, PART_TITLE_CHAR_LIMIT).extend({ status: z.enum(["running", "completed", "failed"]) }),
  subagentPartSchema.extend({ status: z.enum(["running", "completed", "failed"]) })]);
const serializedDraftSchema = z.object({ startedAt: rev, parts: z.array(draftPart).max(MESSAGE_PART_LIMIT),
  streaming: z.array(z.tuple([itemId, text])).max(MESSAGE_PART_LIMIT), plan: z.object({ itemId, status: z.enum(["editing", "completed"]) }).strict().optional() }).strict();
export const liveApprovalSchema = z.object({ approvalId: itemId, kind: z.enum(["command", "file-change", "permissions"]),
  purpose: z.literal("plan-review").optional(), command: text.optional(), reason: text.optional(), diff: z.string().refine(value => utf8Length(value) <= 32 * 1024).optional(), networkHost: z.string().max(256).optional(),
  remoteAllowed: z.boolean().optional(), canAcceptForSession: z.boolean().optional(),
  agentName: z.string().max(256).optional(), choices: z.array(z.object({ decision: remoteApprovalDecisionSchema.optional(), label: z.string().max(1000), tone: z.enum(["primary", "secondary", "danger"]) }).strict()).max(20).optional() }).strict();
const liveInputSchema = z.object({ userInputId: itemId, itemId, questions: z.array(z.object({ id: itemId, header: z.string().max(256).optional(),
  question: text, options: z.array(z.object({ label: z.string().max(1000), description: text }).strict()).max(50).optional(),
  multiSelect: z.boolean().optional(), required: z.boolean().optional(), isOther: z.boolean().optional(), isSecret: z.boolean().optional() }).strict()).max(20),
  agentName: z.string().max(256).optional(), expiresAt: rev.optional() }).strict();
const liveSubagentSchema = z.object({ meta: liveSubagentMetaSchema, detailState: z.enum(["available", "unavailable"]), draft: serializedDraftSchema.optional() }).strict();
export const interactionResultSchema = z.object({ kind: z.enum(["approval", "input"]), interactionId: itemId,
  resolvedBy: interactionSourceSchema }).strict();
export { interactionSourceSchema, type InteractionSource } from "../remote/model";
export type InteractionResult = z.infer<typeof interactionResultSchema>;
export const liveProjectionContentSchema = z.object({ draft: serializedDraftSchema, approvals: z.array(liveApprovalSchema).max(20),
  userInputs: z.array(liveInputSchema).max(20), interactionResults: z.array(interactionResultSchema).max(20).optional(), subagents: z.array(liveSubagentSchema).max(SUBAGENT_DRAFT_LIMIT),
  recovery: z.object({ retryToken: itemId, generation: rev.positive(), allowedActions: z.object({ sameSession: z.boolean(), freshSession: z.boolean(), abandon: z.boolean() }).strict() }).strict().optional(),
  phase: z.enum(["starting", "active", "resume-failed", "retry-claiming"]), terminal: z.enum(["done", "error", "cancelled"]).nullable() }).strict();
const replacementText = z.string().min(1).refine(value => utf8Length(value) <= 16 * 1024);
const replacementIdentity = { snapshotId: itemId, bytes: rev.positive().max(4 * 1024 * 1024), sha256: sha256Schema };
export const liveProjectionSchema = liveProjectionContentSchema.extend({ replacement: z.object({ ...replacementIdentity,
  parts: z.array(replacementText).max(512), receivedBytes: rev.max(4 * 1024 * 1024) }).strict().optional() }).strict();
export const liveEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("replacement-begin"), ...replacementIdentity }).strict(),
  z.object({ type: z.literal("replacement-part"), snapshotId: itemId, index: rev.max(511), text: replacementText }).strict(),
  z.object({ type: z.literal("replacement-commit"), snapshotId: itemId }).strict(),
  z.object({ type: z.literal("replacement-abort"), snapshotId: itemId }).strict(),
  z.object({ type: z.literal("item-delta"), itemId, text }).strict(),
  z.object({ type: z.literal("item"), item: agentTurnItemSchema }).strict(),
  z.object({ type: z.literal("item-removed"), itemId }).strict(),
  z.object({ type: z.literal("approval-requested"), approval: liveApprovalSchema }).strict(),
  z.object({ type: z.literal("approval-closed"), approvalId: itemId, resolvedBy: interactionSourceSchema.optional() }).strict(),
  z.object({ type: z.literal("user-input-requested"), request: liveInputSchema }).strict(),
  z.object({ type: z.literal("user-input-closed"), userInputId: itemId, resolvedBy: interactionSourceSchema.optional() }).strict(),
  z.object({ type: z.literal("subagent-update"), agent: liveSubagentMetaSchema, detailState: z.enum(["available", "unavailable"]) }).strict(),
  z.object({ type: z.literal("subagent-item"), agentThreadId: itemId, agent: liveSubagentMetaSchema, item: agentTurnItemSchema }).strict(),
  z.object({ type: z.literal("subagent-item-delta"), agentThreadId: itemId, agent: liveSubagentMetaSchema, itemId, text }).strict(),
  z.object({ type: z.literal("phase"), phase: liveProjectionSchema.shape.phase }).strict(),
  z.object({ type: z.literal("terminal"), terminal: z.enum(["done", "error", "cancelled"]) }).strict(),
]);
export const LIVE_TURN_LIMITS = { chunkBytes: 64 * 1024, chunkEvents: 32, pageChunks: 3, checkpointBytes: 16 * 1024 * 1024,
  projectionBytes: 4 * 1024 * 1024, bufferBytes: 256 * 1024, bufferEvents: 128,
  flushMs: 500, unknownMs: 24 * 60 * 60_000, finalMs: 5 * 60_000, chunksGcMs: 5 * 60_000, metadataGcMs: 7 * 24 * 60 * 60_000 } as const;
export const turnChunkSchema = z.object({ seq: rev.positive(), payloadHash: sha256Schema,
  events: z.array(liveEventSchema).min(1).max(LIVE_TURN_LIMITS.chunkEvents) }).strict().refine(value =>
    utf8Length(JSON.stringify(value)) <= LIVE_TURN_LIMITS.chunkBytes, "turn-chunk-budget");
export const hashTurnChunk = (chunk: Pick<z.infer<typeof turnChunkSchema>, "seq" | "events">) => hashChatContent({ seq: chunk.seq, events: chunk.events });
export type LiveEvent = z.infer<typeof liveEventSchema>;
export type LiveProjection = z.infer<typeof liveProjectionSchema>;
export type TurnChunk = z.infer<typeof turnChunkSchema>;
