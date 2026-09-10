/**
 * [INPUT]: Depends on Zod and explicit notice requirements supplied by admission
 * [OUTPUT]: Provides the sole contiguous two/three/four-slot allocator and recovery codec
 * [POS]: Shared sequence contract reused by SQLite reservation and ledger v7 recovery
 */
import { z } from "zod";
const seq = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const turnSequencesSchema = z.object({
  executorNoticeSeq: seq.optional(), noticeSeq: seq.optional(), userSeq: seq, assistantSeq: seq,
}).strict().superRefine((value, context) => {
  const slots = [value.executorNoticeSeq, value.noticeSeq, value.userSeq, value.assistantSeq]
    .filter((slot): slot is number => slot !== undefined);
  if (slots.some((slot, index) => index > 0 && slot !== slots[index - 1]! + 1)) {
    context.addIssue({ code: "custom", message: "Turn sequence positions must be contiguous and ordered" });
  }
});
export type TurnSequences = z.infer<typeof turnSequencesSchema>;
export function allocateTurnSequences(first: number, notices: { executor?: boolean; agent?: boolean } = {}): TurnSequences {
  let next = seq.parse(first);
  return turnSequencesSchema.parse({
    ...(notices.executor ? { executorNoticeSeq: next++ } : {}),
    ...(notices.agent ? { noticeSeq: next++ } : {}), userSeq: next++, assistantSeq: next,
  });
}
