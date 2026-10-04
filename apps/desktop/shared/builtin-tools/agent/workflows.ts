/**
 * [INPUT]: Depends on zod and the builtin-tools platform contract.
 * [OUTPUT]: Provides the exact-issued workflow tool specifications: submit_step_result (an agent step's one structured report: result text, optional artifact and evidence references) and read_step_history (a review turn's paged read of the same run's development Chat).
 * [POS]: apps/desktop/shared/builtin-tools/agent; Shared wire truth for a workflow step's report (06 §4). Never ambient and never in Settings: only the workflow executor issues it, for one run, step and attempt, identified by the turn's lease — the Agent names none of them.
 */
import { z } from "zod";
import type { BuiltinToolSpec } from "../platform";

const ref = z.string().min(1).max(512);
export const WORKFLOW_TOOL_SPECS = [
  {
    name: "submit_step_result",
    domainId: "workflows",
    description:
      "Submit this workflow step's result once, when the work is done: `result` is the full answer the next step reads (the plan, the implementation summary, or the review). Add `artifactRef` and `evidenceRefs` only for references Bottega gave you. The run, step and attempt come from this turn; submitting the same result again returns the same receipt, a different one is refused.",
    /* A report to the host, not a business effect: it is issued to read-only planning and review turns too. */
    access: "read",
    exactIssued: true,
    inputSchema: z.object({ result: z.string().min(1).max(65_536), artifactRef: ref.optional(), evidenceRefs: z.array(ref).max(32).optional() }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "read_step_history",
    domainId: "workflows",
    description:
      "Read the history of this task's development Chat, page by page (from `from_seq`). It is the only Chat this review can read; Bottega picks it from this run, and naming any other Chat is refused.",
    /* Issued only to a review turn, bound by its lease to the same run's development Chat (TASK-18). */
    access: "read",
    exactIssued: true,
    inputSchema: z.object({ chat_id: z.string().min(1).max(128).optional(), from_seq: z.number().int().min(0).optional() }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
] as const satisfies readonly BuiltinToolSpec[];
