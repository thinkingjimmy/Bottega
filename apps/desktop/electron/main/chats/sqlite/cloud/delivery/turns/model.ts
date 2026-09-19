/**
 * [INPUT]: Depends on canonical local messages, portable Chat options and shared turn contracts.
 * [OUTPUT]: Defines frozen turn admission and immutable start/chunk/result delivery checkpoints.
 * [POS]: Existing Chat outbox detail; no additional queue or execution authority is introduced.
 */
import { z } from "zod";
import { portableChatSchema } from "@ai-chat/cloud-protocol/chats/model";
import { turnStartSchema, turnFinalSchema } from "@ai-chat/cloud-protocol/turns/model";
import { turnChunkSchema } from "@ai-chat/cloud-protocol/turns/live";
import { turnReceiptSchema } from "@ai-chat/cloud-protocol/chats/content/completion";
import { messageSchema } from "../../../../chat-schema";
import { turnSequencesSchema } from "../../../../../../../shared/chat-agent/sequences";
const id = z.string().min(1).max(128), rev = z.number().int().nonnegative();
export const localTurnAdmissionSchema = z.object({ ledgerIntentId: id, turnId: id, chat: portableChatSchema,
  executorDeviceId: id, executionEpoch: rev.positive(), assistantMessageId: id, sequences: turnSequencesSchema,
  expectedAgentRevision: rev, options: turnStartSchema.shape.options, planRequested: z.boolean(), createdAt: rev,
  user: messageSchema, notices: z.array(messageSchema).max(2),
}).strict().refine(value => value.user.role === "user" && value.user.seq === value.sequences.userSeq &&
  value.options.backend === value.chat.agent && value.notices.every(message => message.role === "notice") &&
  value.notices.length === [value.sequences.executorNoticeSeq, value.sequences.noticeSeq].filter(seq => seq !== undefined).length,
"Invalid frozen local turn");
export type LocalTurnAdmission = z.infer<typeof localTurnAdmissionSchema>;
export const turnCheckpoints = [
  z.object({ kind: z.literal("turn-start"), start: turnStartSchema }).strict(),
  z.object({ kind: z.literal("turn-chunk"), chunk: turnChunkSchema }).strict(),
  z.object({ kind: z.literal("turn-final"), final: turnFinalSchema }).strict(),
  z.object({ kind: z.literal("turn-settled"), receipt: turnReceiptSchema.refine(value => value.settlementState === "settled") }).strict(),
] as const;
