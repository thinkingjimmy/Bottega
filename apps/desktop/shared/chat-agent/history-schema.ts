/**
 * [INPUT]: Depends on strict source-ref and live-view contracts
 * [OUTPUT]: Validates the bounded main-owned handoff before runtime dispatch
 * [POS]: Shared receipt codec; public Agent payloads still reject this field
 */

import { z } from "zod";
import { historyRefSchema } from "./history-tool";
export const handoffSchema = z.object({
  binding: z.object({ chatId: z.string().min(1).max(128),
    view: z.object({ incarnationId: z.string().min(1).max(128), nativeMessageRevision: z.number().int().nonnegative(), activeGenerationId: z.string().nullable() }).strict(),
    cut: z.object({ nativeThroughSeq: z.number().int().nonnegative(), importedThroughSeq: z.number().int().nonnegative() }).strict(),
  }).strict(),
  promptVersion: z.literal(3), promptHash: z.string().regex(/^[a-f0-9]{64}$/),
  text: z.string().refine(value => new TextEncoder().encode(value).length <= 32768),
  refs: z.array(historyRefSchema).max(1000),
  coverage: z.object({ mode: z.enum(["full", "excerpts", "none"]), includedMessages: z.number().int().nonnegative().optional(), totalMessages: z.number().int().nonnegative().optional(), historyIncluded: z.boolean(), notInjected: z.boolean(), storageTrimmed: z.boolean(),
    lookup: z.enum(["available", "disabled", "unsupported", "unavailable"]) }).strict(),
}).strict();
