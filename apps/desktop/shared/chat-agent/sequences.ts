/**
 * [INPUT]: Depends on Zod and explicit notice requirements supplied by admission
 * [OUTPUT]: Provides the sole contiguous two/three-slot allocator and recovery codec
 * [POS]: Shared sequence contract reused by SQLite reservation and ledger v7 recovery
 */
import { z } from "zod";
const seq = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const turnSequencesSchema = z.object({
  noticeSeq: seq.optional(), userSeq: seq, assistantSeq: seq,
}).strict().superRefine((value, context) => {
  const slots = [value.noticeSeq, value.userSeq, value.assistantSeq]
    .filter((slot): slot is number => slot !== undefined);
  if (slots.some((slot, index) => index > 0 && slot !== slots[index - 1]! + 1)) {
    context.addIssue({ code: "custom", message: "Turn sequence positions must be contiguous and ordered" });
  }
});
export type TurnSequences = z.infer<typeof turnSequencesSchema>;
export function allocateTurnSequences(first: number, notices: { agent?: boolean } = {}): TurnSequences {
  let next = seq.parse(first);
  return turnSequencesSchema.parse({
    ...(notices.agent ? { noticeSeq: next++ } : {}), userSeq: next++, assistantSeq: next,
  });
}
