/**
 * [INPUT]: Depends on the workflow run contract, canonical JSON and the workflow projection model.
 * [OUTPUT]: Provides cutUtf8 (the longest prefix within a UTF-8 byte budget that ends on a whole code point) and projectWorkflowRun: the owner desktop's run as a phone may see it — no configurations, inputs, process groups or request ids; a report's result cut to 4 KiB of UTF-8 at a code-point boundary (A2-05; the 512 / 64 tiers are bytes too) with its Chat named; evidence reduced to its summary — always within the purpose-12 budget.
 * [POS]: The automatic run-summary disclosure boundary (§10.2); explicit evidence reads use separately bounded encrypted resource commands.
 */
import { canonicalJson } from "../encryption/encoding";
import type { WorkflowRoleName } from "../contracts/workflow/recipe";
import type { WorkflowRun } from "../contracts/workflow/run";
import { utf8Bytes, WORKFLOW_PROJECTION_LIMITS, workflowRunProjectionSchema, type WorkflowRunProjection } from "./model";

type Chats = Readonly<Partial<Record<WorkflowRoleName, string>>>;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function evidenceSummary(value: unknown) {
  if (!isObject(value)) return undefined;
  const code = isObject(value.code) ? value.code : null, diff = code && isObject(code.diff) ? code.diff : null;
  return { commit: typeof code?.commit === "string" ? code.commit.slice(0, 128) : null, changedCount: typeof code?.changedCount === "number" ? code.changedCount : 0,
    diffState: typeof diff?.state === "string" ? diff.state as "included" : null, commandsRecorded: Array.isArray(value.commands) ? value.commands.length : null };
}
/** The longest prefix within `limit` UTF-8 bytes that ends on a whole code point (A2-05): never half an emoji. */
export function cutUtf8(value: string, limit: number) {
  if (utf8Bytes(value) <= limit) return value;
  let used = 0, end = 0;
  for (const char of value) {
    const code = char.codePointAt(0)!, size = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (used + size > limit) break;
    used += size; end += char.length;
  }
  return value.slice(0, end);
}
/* Any other output (a Base read, an action's answer) keeps its shape; long text is cut, and the output says so. */
function cutStrings(value: unknown, limit: number, cut: { any: boolean }): unknown {
  if (typeof value === "string") { const kept = cutUtf8(value, limit); if (kept !== value) cut.any = true; return kept; }
  if (Array.isArray(value)) return value.map(item => cutStrings(item, limit, cut));
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cutStrings(item, limit, cut)]));
  return value;
}
function projectOutput(kind: string, output: unknown, limit: number): unknown {
  if (output === null || output === undefined) return null;
  if (kind === "agent.run" && isObject(output) && typeof output.result === "string") {
    const evidence = evidenceSummary(output.evidence);
    const result = cutUtf8(output.result, limit);
    return { result, ...(result !== output.result ? { resultTruncated: true } : {}),
      ...(typeof output.chatRef === "string" ? { chatRef: output.chatRef } : {}), ...(evidence ? { evidence } : {}) };
  }
  const cut = { any: false }, value = cutStrings(output, limit, cut);
  return cut.any && isObject(value) ? { ...value, outputTruncated: true } : value;
}
function build(run: WorkflowRun, chats: Chats, limit: number): WorkflowRunProjection {
  const kinds = new Map(run.recipe.steps.map(step => [step.id, step.kind]));
  return workflowRunProjectionSchema.parse({
    runId: run.runId, bindingId: run.bindingId, record: run.record,
    recipe: { recipeId: run.recipe.recipeId, version: run.recipe.version,
      steps: run.recipe.steps.map(step => ({ id: step.id, kind: step.kind, ...(step.kind === "agent.run" ? { role: step.role } : {}), label: step.label })) },
    state: run.state, pauseRequested: run.pauseRequested, pauseReason: run.pauseReason,
    steps: run.steps.map(step => ({ stepId: step.stepId, state: step.state, blockedReason: step.blockedReason,
      attempts: step.attempts.map(({ outcome, intentAt, settledAt, detail, reportDerived }) => ({ outcome, intentAt, settledAt, detail, reportDerived })),
      output: projectOutput(kinds.get(step.stepId) ?? "", step.output, limit) })),
    confirmations: run.confirmations, businessOutcome: run.businessOutcome, cancelRequestedAt: run.cancelRequestedAt, forcedStop: run.forcedStop,
    forceStopUnconfirmedAt: run.forceStopUnconfirmedAt, workspaceWait: run.workspaceWait, blockedReason: run.blockedReason,
    createdAt: run.createdAt, updatedAt: run.updatedAt, revision: run.revision, chats: { ...chats },
  });
}
/** Within the purpose-12 budget: text is cut to 4 KiB of UTF-8, and further (to 512, then 64 bytes) only if the run is still too large. */
export function projectWorkflowRun(run: WorkflowRun, context: { chats: Chats }): WorkflowRunProjection {
  let projection: WorkflowRunProjection | null = null;
  for (const limit of [WORKFLOW_PROJECTION_LIMITS.resultBytes, 512, 64]) {
    projection = build(run, context.chats, limit);
    if (utf8Bytes(canonicalJson(projection)) <= WORKFLOW_PROJECTION_LIMITS.runPlaintextBytes) return projection;
  }
  throw new Error("workflow-run-budget");
}
