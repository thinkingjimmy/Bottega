/**
 * [INPUT]: Depends on the run contract and the canonical request digest.
 * [OUTPUT]: Provides readWitness (the base.read witness a run holds), sameWitness, reworkDraft (after a rework request, from a fresh read: keep the plan or replan, both always offered; unchanged → keep-plan by default into development, changed → replan by default with a typed reason, and keeping the plan then starts at the plan confirmation), reworkStart (the chosen draft as createRun input, carrying the fresh read) and proposalDigest (what a confirmation is bound to).
 * [POS]: The rework and confirmation-binding half of contracts/workflow; pure, shared by the desktop ledger and every surface that shows a draft or a confirmation.
 */
import { requestDigest } from "../core/canonical";
import type { ReworkReason, ReworkStart, WorkflowRun } from "./run";

/** Each input field's last-change token from the Base (a change sequence, so A→B→A is still a change), never its value. */
export type FieldWitness = { task: string; acceptanceCriteria: string };

/** Whether two reads saw the same relevant input (the task and the criteria); nothing read is never the same as something read. */
export const sameWitness = (a: FieldWitness | null, b: FieldWitness | null) => a?.task === b?.task && a?.acceptanceCriteria === b?.acceptanceCriteria;

export function readWitness(run: WorkflowRun): FieldWitness | null {
  const read = run.recipe.steps.find(step => step.kind === "app.call" && step.action === "base.read");
  const output = run.steps.find(step => step.stepId === read?.id)?.output as { witness?: FieldWitness } | null | undefined;
  return output?.witness && typeof output.witness.task === "string" && typeof output.witness.acceptanceCriteria === "string" ? output.witness : null;
}

/**
 * `keepPlanStartsAt`: where keeping the plan starts. Unchanged record: at `reworkFrom`, the plan already confirmed. A
 * changed record: at the plan confirmation, so the old plan is shown again with the new task and criteria and runs only
 * once the person accepts it against them.
 */
export type ReworkDraft = { previousRunId: string; default: "keep-plan" | "replan"; reason: ReworkReason | null; choices: readonly ("keep-plan" | "replan")[];
  keepPlanStartsAt: string };
/** A fresh base.read output: the record's task and criteria now, with their change witness. */
export type FreshRead = { task: string; acceptanceCriteria: string; witness: FieldWitness };

/**
 * The draft a rework request offers, from a fresh read of the record. Both choices are always offered.
 * Unchanged task and criteria: keeping the accepted plan is the default and goes straight to development. Any change —
 * or a previous run with no witness to compare — makes replanning the default with its reason; keeping the old plan
 * then starts at the plan confirmation instead, so a typo fix need not replan while an old plan never runs unconfirmed.
 */
export function reworkDraft(previous: WorkflowRun, current: FieldWitness): ReworkDraft | null {
  if (previous.businessOutcome !== "rework-requested") return null;
  const before = readWitness(previous);
  const reason: ReworkReason | null = !before ? "task-changed" : before.task !== current.task ? "task-changed"
    : before.acceptanceCriteria !== current.acceptanceCriteria ? "acceptance-criteria-changed" : null;
  const confirmPlan = previous.recipe.steps.find(step => step.kind === "human.confirm" && step.confirmation === "plan")?.id ?? previous.recipe.reworkFrom;
  return { previousRunId: previous.runId, default: reason ? "replan" : "keep-plan", reason, choices: ["keep-plan", "replan"],
    keepPlanStartsAt: reason ? confirmPlan : previous.recipe.reworkFrom };
}

/** The chosen draft as createRun input; the fresh read replaces the old one, so every later step and digest sees the record as it is now. */
export function reworkStart(previous: WorkflowRun, draft: ReworkDraft, choice: "keep-plan" | "replan", fresh: FreshRead): ReworkStart | null {
  if (!draft.choices.includes(choice) || draft.previousRunId !== previous.runId) return null;
  if (choice === "replan") return { previousRunId: previous.runId, replan: draft.reason ?? "user-chose-replan" };
  const start = previous.recipe.steps.findIndex(step => step.id === draft.keepPlanStartsAt);
  const read = previous.recipe.steps.find(step => step.kind === "app.call" && step.action === "base.read")?.id;
  const carried = Object.fromEntries(previous.steps.slice(0, start).map(step => [step.stepId, step.stepId === read ? fresh : step.output]));
  return { previousRunId: previous.runId, carried, startAt: draft.keepPlanStartsAt };
}

/**
 * A confirmation is bound to what it was about: the recipe version, the input witness, every agent result and
 * evidence reference so far, and the proposal shown. An unrelated card edit changes none of these; an edited criterion,
 * a new plan or a new implementation snapshot does, and the pending confirmation goes stale.
 */
export function proposalDigest(run: WorkflowRun, proposal: string) {
  const agentOutputs = run.recipe.steps.filter(step => step.kind === "agent.run")
    .map(step => [step.id, run.steps.find(item => item.stepId === step.id)?.output ?? null]);
  return requestDigest({ recipe: { recipeId: run.recipe.recipeId, version: run.recipe.version }, witness: readWitness(run), agentOutputs, proposal });
}
