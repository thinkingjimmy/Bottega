/**
 * [INPUT]: Depends on Zod, the recipe contract and the BaseRef resource contract.
 * [OUTPUT]: Provides the workflow run model (run / step / attempt / confirmation, pause reason, rework reason, the typed blockedReason on a step mirrored on its run), the client's confirmation input (decision, expected proposal, operation id — never an operator), and the pure transitions: createRun (fresh, keep-plan or replan rework), beginStep (bounded by MAX_ATTEMPTS), recordDispatch (the turn's request id, durable before it is sent), recordReport (one report per attempt), refreshRead / supersedeConfirmation (a changed input withdraws the waiting confirmation and asks again), waitForWorkspace (a writing step waits for the run holding its workspace), settleStep (a pause asked for is honoured when the step blocks), requestConfirmation, confirm, pause (with reason), resume, cancel (records when it was asked), forceStop (only once the step's process tree is confirmed gone; StopProof says how), forceStopUnconfirmed and restateBlocked. mayStillRun (an unknown cleanup outcome with a request keeps a Cancel cancelling). PROVIDER_AUTH_UNCERTAIN (four blocked / extractor kinds for sign-in not established). pauseWithdrawingConfirmation (archive withdraws an unanswered confirmation, keeping it in history, and pauses) and restatePause (restore turns the archive's pause into an ordinary one).
 * Role and extractor refusals distinguish an installed CLI version that is too old.
 * The persisted block vocabulary distinguishes unavailable measurement evidence from missing installation.
 * [POS]: The one state machine behind the desktop run ledger and every projection of it. A run freezes its recipe, binding, resolved configurations and inputs; terminal runs never change; rework is a new run.
 */
import { z } from "zod";
import { baseRefSchema } from "../model/resources";
import { BINDING_REASONS } from "../base/binding";
import { stepReportSchema, type StepReport } from "./report";
export { stepReportSchema, type StepReport } from "./report";
import { workflowRecipeSchema, type WorkflowRecipe } from "./recipe";

const id = z.string().min(1).max(128);
export const RUN_STATES = ["queued", "running", "waiting-human", "paused", "blocked", "cancelling", "succeeded", "failed", "cancelled"] as const;
export const TERMINAL_RUN_STATES = ["succeeded", "failed", "cancelled"] as const;
export const STEP_STATES = ["pending", "running", "waiting-human", "succeeded", "failed", "blocked", "carried", "not-run"] as const;
export const BUSINESS_OUTCOMES = ["accepted", "accepted-with-exceptions", "ended-by-user", "rework-requested", "cancelled", "failed"] as const;
const json = z.json();
/** Why a run is paused: a person asked, its binding was suspended, or the plugin supplying a step's Provider was turned off. */
/** `confirmation-timeout`: a confirmation waited 24 hours; the run never continues on its own. */
export const pauseReasonSchema = z.object({ kind: z.enum(["user", "binding-suspended", "plugin-disabled", "confirmation-timeout"]), detail: z.string().max(128).nullable() }).strict();
export type PauseReason = z.infer<typeof pauseReasonSchema>;
/** Why a rework run replans instead of keeping the accepted plan. */
export const REWORK_REASONS = ["task-changed", "acceptance-criteria-changed", "user-chose-replan"] as const;
export type ReworkReason = (typeof REWORK_REASONS)[number];

export const attemptSchema = z.object({ attemptId: id, intentAt: z.number().int(), outcome: z.enum(["open", "succeeded", "failed", "blocked", "unknown"]),
  settledAt: z.number().int().nullable(), detail: z.string().max(512).nullable(),
  /** The one report this attempt accepted, with its digest; a different second report is a conflict. */
  report: stepReportSchema.nullable().default(null), reportDigest: z.string().max(128).nullable().default(null),
  /** The report was not submitted but extracted from the turn's own result (deterministically or by the format extractor). */
  reportDerived: z.boolean().default(false),
  /** Format-extractor calls spent on this attempt; at most two. */
  extractions: z.number().int().min(0).max(2).default(0),
  /** The request id of the turn this attempt sends, recorded before it is sent: what custody knows the turn's process by after a restart. */
  requestId: id.nullable().default(null) }).strict();
/** A step's attempts are bounded; the last one spent leaves the step blocked with `attempts-exhausted`. */
export const MAX_ATTEMPTS = 16;
/**
 * Why a step (and so its run) is blocked, typed so the interface can name it and offer one next step (plan maintenance 2026-09-26):
 * the Provider is signed out or not installed, its plugin is off, it is not measured on this computer or cannot take the role, the
 * role's configuration is gone, the binding is suspended or the record deleted (`cause`), the turn left no valid report, it could not be
 * sent, or a Base action failed (`action` and `failure`). Sign-in not established — the check answered nothing (`unknown`), is still
 * running (`checking`), failed (`error`), or did not answer within the bound (`timeout`); none of these is ready.
 */
export const PROVIDER_AUTH_UNCERTAIN = ["provider-auth-unknown", "provider-auth-checking", "provider-auth-error", "provider-auth-timeout"] as const;
export const BLOCKED_REASON_KINDS = ["provider-signed-out", "provider-not-installed", "provider-measurements-unavailable", "provider-version-too-old", "plugin-disabled", "not-measured", "provider-cannot",
  "config-unavailable", "binding-suspended", "no-valid-report", "dispatch-failed", "base-action-failed", "attempts-exhausted", "guarantee-unavailable",
  ...PROVIDER_AUTH_UNCERTAIN] as const;
/** `guarantee-unavailable`: what the configuration asked for that this step cannot have — a read-only workspace for development, or no network (nothing can guarantee it yet). */
export const REQUESTED_GUARANTEES = ["workspace-read-only", "network-off"] as const;
/** What suspended the binding, or the record the run works on having been deleted. */
export const BLOCKED_CAUSES = [...BINDING_REASONS, "record-missing"] as const;
/** A Base action (app.call) that failed for a reason other than the binding: which action, and why, closed. */
/** Why the format extractor could not run or did not produce a report. */
export const EXTRACTOR_BLOCKS = ["plugin-disabled", "provider-not-installed", "provider-version-too-old", "provider-signed-out", "not-measured", "failed", ...PROVIDER_AUTH_UNCERTAIN] as const;
export const BASE_ACTION_FAILURES = ["base-unavailable", "write-refused", "conflict", "unknown"] as const;
export const blockedReasonSchema = z.object({ kind: z.enum(BLOCKED_REASON_KINDS), provider: z.string().max(32).nullable(),
  role: z.enum(["plan", "develop", "review"]).nullable(), cause: z.enum(BLOCKED_CAUSES).nullable(),
  action: z.enum(["read", "set-stage", "write-summary"]).nullable(), failure: z.enum(BASE_ACTION_FAILURES).nullable(),
  /** `no-valid-report` only: why the format extractor (Claude, no tools) could not repair it; `provider` is then "claude". */
  extractor: z.enum(EXTRACTOR_BLOCKS).nullable().optional(),
  /** `guarantee-unavailable` only: which requested guarantee. */
  guarantee: z.enum(REQUESTED_GUARANTEES).nullable().optional() }).strict();
export type BlockedReason = z.infer<typeof blockedReasonSchema>;
const stepSchema = z.object({ stepId: id, state: z.enum(STEP_STATES), attempts: z.array(attemptSchema).max(MAX_ATTEMPTS), output: json.nullable(),
  blockedReason: blockedReasonSchema.nullable().default(null) }).strict();
/** Operator, device and time come from the verified session and the host clock, never from the client. */
const operatorSchema = z.object({ userId: id, deviceId: id }).strict();
export const confirmationSchema = z.object({ stepId: id, proposalDigest: z.string().min(1).max(128), requestedAt: z.number().int(),
  decision: z.object({ decision: z.enum(["accept", "end", "rework"]), exceptionReason: z.string().min(1).max(2_000).nullable(), operator: operatorSchema,
    at: z.number().int(), operationId: id }).strict().nullable(),
  /** The reminders already sent, durable so a restart never sends one twice: at the start, and in the 23rd hour. */
  reminders: z.array(z.enum(["started", "final-hour"])).max(2).default([]),
  /** Set when the confirmation waited 24 hours: it can no longer be decided; resuming asks again from a fresh proposal. */
  expiredAt: z.number().int().nullable().default(null) }).strict();
export const workflowRunSchema = z.object({
  runId: id, bindingId: id, record: z.object({ base: baseRefSchema, rowId: id }).strict(),
  /** Frozen when the run is created: the recipe, the binding revision, each role's resolved configuration and the inputs. */
  recipe: workflowRecipeSchema, bindingRevision: z.number().int().min(0), configs: z.record(id, json), inputs: z.record(id, z.string().max(65_536)),
  state: z.enum(RUN_STATES), pauseRequested: z.boolean(), pauseReason: pauseReasonSchema.nullable(), steps: z.array(stepSchema), confirmations: z.array(confirmationSchema),
  businessOutcome: z.enum(BUSINESS_OUTCOMES).nullable(), previousRunId: id.nullable(), startFrom: id, reworkReason: z.enum(REWORK_REASONS).nullable(),
  /** When cancel was asked for, so "Cancelling" can say for how long; a forced stop is its own fact, the outcome stays cancelled. */
  cancelRequestedAt: z.number().int().nullable().default(null), forcedStop: z.boolean().default(false),
  /** Force stop killed the step's process tree but could not confirm it gone: the run stays cancelling, says a process may still be running, and offers Force stop again. */
  forceStopUnconfirmedAt: z.number().int().nullable().default(null),
  /**
   * The process groups Force stop could not confirm gone, by pid + birth, so a retry or a restart can prove what became of them;
   * `null` is a turn whose group could not be identified, which nothing can prove stopped.
   */
  forceStopGroups: z.array(z.object({ pid: z.number().int().positive(), birthIdentity: z.string().min(1).max(128) }).strict().nullable()).max(8).default([]),
  /** The blocked step's reason, or the suspended binding's, mirrored for the run's tag and the needs-you list. */
  blockedReason: blockedReasonSchema.nullable().default(null),
  /** The next writing step waits for another run that holds this workspace's writer lease; no attempt is spent while it waits. */
  workspaceWait: z.object({ heldByRunId: id, since: z.number().int() }).strict().nullable().default(null),
  createdAt: z.number().int(), updatedAt: z.number().int(), revision: z.number().int().min(0),
}).strict();
export type WorkflowRun = z.infer<typeof workflowRunSchema>;
/** What a client may send to confirm: the decision, the proposal it saw, an operation id and a reason if needed. */
export const confirmInputSchema = z.object({ decision: z.enum(["accept", "end", "rework"]), proposalDigest: z.string().min(1).max(128),
  operationId: id, exceptionReason: z.string().min(1).max(2_000).optional() }).strict();
export type ConfirmInput = z.infer<typeof confirmInputSchema>;
export type VerifiedOperator = z.infer<typeof operatorSchema>;

export type RunError = "run-terminal" | "not-due" | "extraction-budget" | "not-next-step" | "unknown-step" | "stale-attempt" | "not-running" | "not-waiting" | "already-resolved"
  | "stale-proposal" | "decision-not-allowed" | "reason-required" | "bad-start" | "carried-missing" | "not-paused" | "report-conflict" | "not-an-agent-step"
  | "attempts-exhausted";
type Result = { ok: true; run: WorkflowRun } | { ok: false; code: RunError };
const fail = (code: RunError): Result => ({ ok: false, code });
const terminal = (run: WorkflowRun) => (TERMINAL_RUN_STATES as readonly string[]).includes(run.state);
const touch = (run: WorkflowRun, now: number): WorkflowRun => ({ ...run, updatedAt: now, revision: run.revision + 1 });

/** How a rework run starts: keep the accepted plan and carry what came before `reworkFrom`, or replan from the first step. */
export type ReworkStart = { previousRunId: string; carried: Record<string, unknown>; startAt?: string } | { previousRunId: string; replan: ReworkReason };
/**
 * A new run. A rework run either starts at the recipe's `reworkFrom` carrying the earlier steps' outputs from the run it
 * replaces, or replans from the first step with a typed reason; it is never the old run resumed.
 */
export function createRun(input: { runId: string; bindingId: string; bindingRevision: number; record: WorkflowRun["record"]; recipe: WorkflowRecipe;
  configs: Record<string, unknown>; inputs: Record<string, string>; now: number; rework?: ReworkStart }): Result {
  const keep = input.rework && "carried" in input.rework ? input.rework : null;
  const recipe = structuredClone(input.recipe), start = keep ? keep.startAt ?? recipe.reworkFrom : recipe.steps[0]!.id;
  /* Keeping a plan starts at `reworkFrom` or, for a changed record, at the plan confirmation — never anywhere else. */
  const planConfirmation = recipe.steps.find(step => step.kind === "human.confirm" && step.confirmation === "plan")?.id;
  if (keep?.startAt && keep.startAt !== recipe.reworkFrom && keep.startAt !== planConfirmation) return fail("bad-start");
  const startIndex = recipe.steps.findIndex(step => step.id === start);
  if (startIndex < 0) return fail("bad-start");
  const steps = recipe.steps.map((step, index) => {
    if (index >= startIndex) return { stepId: step.id, state: "pending" as const, attempts: [], output: null, blockedReason: null };
    const carried = keep?.carried[step.id];
    return { stepId: step.id, state: "carried" as const, attempts: [], output: (carried ?? null) as z.infer<typeof json> | null, blockedReason: null };
  });
  if (keep && steps.some(step => step.state === "carried" && step.output === null)) return fail("carried-missing");
  return { ok: true, run: workflowRunSchema.parse({ runId: input.runId, bindingId: input.bindingId, record: input.record, recipe, bindingRevision: input.bindingRevision,
    configs: structuredClone(input.configs), inputs: { ...input.inputs }, state: "queued", pauseRequested: false, pauseReason: null, steps, confirmations: [],
    businessOutcome: null, previousRunId: input.rework?.previousRunId ?? null, startFrom: start,
    reworkReason: input.rework && "replan" in input.rework ? input.rework.replan : null, cancelRequestedAt: null, forcedStop: false, forceStopUnconfirmedAt: null, forceStopGroups: [], blockedReason: null, workspaceWait: null, createdAt: input.now, updatedAt: input.now, revision: 0 }) };
}

/** The durable intent before any effect: only the next pending step, or a new attempt of a blocked one, may begin. */
export function beginStep(run: WorkflowRun, stepId: string, attemptId: string, now: number): Result {
  if (terminal(run)) return fail("run-terminal");
  if (run.state === "paused" || run.state === "cancelling" || run.pauseRequested) return fail("not-running");
  const index = run.steps.findIndex(step => step.stepId === stepId);
  if (index < 0) return fail("unknown-step");
  const next = run.steps.findIndex(step => step.state === "pending" || step.state === "blocked");
  const step = run.steps[index]!;
  if (index !== next || run.steps.some(item => item.state === "running" || item.state === "waiting-human")) return fail("not-next-step");
  if (step.attempts.length >= MAX_ATTEMPTS) return fail("attempts-exhausted");
  const steps = run.steps.map((item, i) => i === index ? { ...step, state: "running" as const, blockedReason: null,
    attempts: [...step.attempts, { attemptId, intentAt: now, outcome: "open" as const, settledAt: null, detail: null, report: null, reportDigest: null,
      reportDerived: false, extractions: 0, requestId: null }] } : item);
  return { ok: true, run: touch({ ...run, state: "running", steps, blockedReason: null }, now) };
}

/**
 * Records the report an agent step's current attempt submitted. Only the open attempt of an agent step takes one;
 * the same report again changes nothing, a different one is `report-conflict`, and a report for an older attempt is
 * `stale-attempt`. Recording a report does not settle the step: the executor's latch does, once the turn is also done.
 */
export function recordReport(run: WorkflowRun, stepId: string, attemptId: string, report: StepReport, digest: string, now: number, derived = false): Result {
  if (terminal(run)) return fail("run-terminal");
  const index = run.steps.findIndex(step => step.stepId === stepId);
  const step = run.steps[index];
  if (!step || run.recipe.steps.find(item => item.id === stepId)?.kind !== "agent.run") return fail("not-an-agent-step");
  const current = step.attempts.at(-1);
  if (!current || current.attemptId !== attemptId || current.outcome !== "open") return fail("stale-attempt");
  if (current.reportDigest) return current.reportDigest === digest ? { ok: true, run } : fail("report-conflict");
  const attempts = [...step.attempts.slice(0, -1), { ...current, report: stepReportSchema.parse(report), reportDigest: digest, reportDerived: derived }];
  return { ok: true, run: touch({ ...run, steps: run.steps.map((item, i) => i === index ? { ...step, attempts } : item) }, now) };
}

/** The turn of the open attempt is about to be sent: its request id is durable before any process can exist for it. */
export function recordDispatch(run: WorkflowRun, stepId: string, attemptId: string, requestId: string, now: number): Result {
  const index = run.steps.findIndex(step => step.stepId === stepId), step = run.steps[index];
  const current = step?.attempts.at(-1);
  if (!step || !current || current.attemptId !== attemptId || current.outcome !== "open") return fail("stale-attempt");
  if (run.state !== "running") return fail("not-running");
  const attempts = [...step.attempts.slice(0, -1), { ...current, requestId }];
  return { ok: true, run: touch({ ...run, steps: run.steps.map((item, i) => i === index ? { ...step, attempts } : item) }, now) };
}

/** One format-extractor call is spent on the open attempt (recorded before it runs); a third is refused. */
export function countExtraction(run: WorkflowRun, stepId: string, attemptId: string, now: number): Result {
  const index = run.steps.findIndex(step => step.stepId === stepId), step = run.steps[index];
  const current = step?.attempts.at(-1);
  if (!step || !current || current.attemptId !== attemptId || current.outcome !== "open") return fail("stale-attempt");
  if (current.extractions >= 2) return fail("extraction-budget");
  const attempts = [...step.attempts.slice(0, -1), { ...current, extractions: current.extractions + 1 }];
  return { ok: true, run: touch({ ...run, steps: run.steps.map((item, i) => i === index ? { ...step, attempts } : item) }, now) };
}

/**
 * Settles the current attempt only; a late settle of an older attempt changes nothing. A failed required step fails
 * the run; `blocked` and `unknown` stop the run until a new attempt or a check resolves it; the last step's success
 * ends the run with the result confirmation's outcome.
 */
export function settleStep(run: WorkflowRun, stepId: string, attemptId: string, outcome: "succeeded" | "failed" | "blocked" | "unknown", output: unknown,
  now: number, detail: string | null = null, blockedReason: BlockedReason | null = null): Result {
  if (terminal(run)) return fail("run-terminal");
  const index = run.steps.findIndex(step => step.stepId === stepId);
  const step = run.steps[index];
  const current = step?.attempts.at(-1);
  if (!step || !current || current.attemptId !== attemptId || current.outcome !== "open") return fail("stale-attempt");
  const attempts = [...step.attempts.slice(0, -1), { ...current, outcome, settledAt: now, detail }];
  const stepState = outcome === "succeeded" ? "succeeded" as const : outcome === "failed" ? "failed" as const : "blocked" as const;
  const reason = outcome === "blocked" ? blockedReason : null;
  const steps = run.steps.map((item, i) => i === index ? { ...step, state: stepState, attempts, output: outcome === "succeeded" ? output as z.infer<typeof json> : null,
    blockedReason: reason } : item);
  let next: WorkflowRun = { ...run, steps, blockedReason: reason };
  if (run.state === "cancelling") next = { ...next, state: "cancelled", steps: steps.map(item => item.state === "pending" ? { ...item, state: "not-run" as const } : item) };
  else if (outcome === "failed") next = { ...next, state: "failed", businessOutcome: "failed",
    steps: steps.map(item => item.state === "pending" ? { ...item, state: "not-run" as const } : item) };
  /* A pause asked for while the step ran is honoured when it blocks too: paused, the step keeps its reason, the latch clears. */
  else if (outcome !== "succeeded") next = { ...next, state: run.pauseRequested ? "paused" : "blocked", pauseRequested: false };
  else if (!steps.some(item => item.state === "pending")) next = { ...next, state: "succeeded", businessOutcome: resultOutcome(run) };
  else next = { ...next, state: run.pauseRequested ? "paused" : "running", pauseRequested: false };
  return { ok: true, run: touch(next, now) };
}
const resultOutcome = (run: WorkflowRun) => {
  const last = [...run.confirmations].reverse().find(item => item.decision);
  return last?.decision?.exceptionReason ? "accepted-with-exceptions" as const : "accepted" as const;
};

export function requestConfirmation(run: WorkflowRun, stepId: string, proposalDigest: string, now: number): Result {
  if (terminal(run)) return fail("run-terminal");
  const index = run.steps.findIndex(step => step.stepId === stepId);
  const step = run.steps[index], recipeStep = run.recipe.steps.find(item => item.id === stepId);
  if (!step || recipeStep?.kind !== "human.confirm") return fail("unknown-step");
  if (step.state !== "running") return fail("not-running");
  const steps = run.steps.map((item, i) => i === index ? { ...step, state: "waiting-human" as const } : item);
  return { ok: true, run: touch({ ...run, state: "waiting-human", steps,
    confirmations: [...run.confirmations.filter(item => item.stepId !== stepId || item.decision), { stepId, proposalDigest, requestedAt: now, decision: null, reminders: [], expiredAt: null }] }, now) };
}

export const CONFIRMATION_REMIND_AT_MS = 23 * 3_600_000;
export const CONFIRMATION_TIMEOUT_MS = 24 * 3_600_000;
const openConfirmation = (run: WorkflowRun, stepId: string) =>
  run.state === "waiting-human" ? run.confirmations.find(item => item.stepId === stepId && !item.decision && item.expiredAt === null) : undefined;

/** A reminder about a waiting confirmation was sent (recorded before it goes out, so it goes out at most once). */
export function remindConfirmation(run: WorkflowRun, stepId: string, reminder: "started" | "final-hour", now: number): Result {
  const pending = openConfirmation(run, stepId);
  if (!pending) return fail("not-waiting");
  if (pending.reminders.includes(reminder)) return { ok: true, run };
  return { ok: true, run: touch({ ...run, confirmations: run.confirmations.map(item => item === pending ? { ...item, reminders: [...item.reminders, reminder] } : item) }, now) };
}

/**
 * A confirmation that waited 24 hours: it expires, its step goes back to pending and the run pauses with
 * `confirmation-timeout`. Nothing continues on its own; resume asks again from a fresh proposal, with a fresh clock.
 */
export function expireConfirmation(run: WorkflowRun, stepId: string, now: number): Result {
  const pending = openConfirmation(run, stepId);
  if (!pending) return fail("not-waiting");
  if (now - pending.requestedAt < CONFIRMATION_TIMEOUT_MS) return fail("not-due");
  const steps = run.steps.map(step => step.stepId !== stepId ? step : { ...step, state: "pending" as const,
    attempts: step.attempts.map(item => item.outcome === "open" ? { ...item, outcome: "blocked" as const, settledAt: now, detail: "confirmation-timeout" } : item) });
  return { ok: true, run: touch({ ...run, steps, state: "paused", pauseRequested: false, pauseReason: { kind: "confirmation-timeout", detail: stepId },
    confirmations: run.confirmations.map(item => item === pending ? { ...item, expiredAt: now } : item) }, now) };
}

/**
 * One decision lands: the same operation replays, anything else is `already-resolved`; a proposal that changed since
 * the request is `stale-proposal`. Plan confirmation takes accept or end; the result takes accept, end or rework;
 * an exception needs a reason. The operator is the verified one passed by the host.
 */
export function confirm(run: WorkflowRun, stepId: string, raw: ConfirmInput, operator: VerifiedOperator, now: number):
  Result {
  const input = confirmInputSchema.parse(raw);
  const pending = run.confirmations.find(item => item.stepId === stepId && !item.decision) ??
    [...run.confirmations].reverse().find(item => item.stepId === stepId);
  if (!pending || (!pending.decision && pending.expiredAt !== null)) return fail("not-waiting");
  if (pending.decision) return pending.decision.operationId === input.operationId && pending.decision.decision === input.decision ? { ok: true, run } : fail("already-resolved");
  if (terminal(run)) return fail("run-terminal");
  if (input.proposalDigest !== pending.proposalDigest) return fail("stale-proposal");
  const kind = run.recipe.steps.find(item => item.id === stepId);
  if (kind?.kind !== "human.confirm") return fail("unknown-step");
  if (kind.confirmation === "plan" && input.decision === "rework") return fail("decision-not-allowed");
  if (kind.confirmation === "plan" && input.exceptionReason) return fail("decision-not-allowed");
  const decision = { decision: input.decision, exceptionReason: input.exceptionReason ?? null, operator: { ...operator }, at: now, operationId: input.operationId };
  const confirmations = run.confirmations.map(item => item === pending ? { ...item, decision } : item);
  const index = run.steps.findIndex(step => step.stepId === stepId), step = run.steps[index]!;
  const current = step.attempts.at(-1)!;
  const closed = { ...step, state: "succeeded" as const, output: { decision: input.decision, proposalDigest: pending.proposalDigest },
    attempts: [...step.attempts.slice(0, -1), { ...current, outcome: "succeeded" as const, settledAt: now, detail: null }] };
  let steps = run.steps.map((item, i) => i === index ? closed : item);
  if (input.decision === "accept") {
    const done = !steps.some(item => item.state === "pending");
    return { ok: true, run: touch({ ...run, confirmations, steps, state: done ? "succeeded" : run.pauseRequested ? "paused" : "running", pauseRequested: false,
      businessOutcome: done ? (decision.exceptionReason ? "accepted-with-exceptions" : "accepted") : null }, now) };
  }
  steps = steps.map(item => item.state === "pending" ? { ...item, state: "not-run" as const } : item);
  /* Rework ends this run; the draft for the new one comes from a fresh read (rework.ts reworkDraft). */
  return { ok: true, run: touch({ ...run, confirmations, steps, state: "cancelled", businessOutcome: input.decision === "end" ? "ended-by-user" : "rework-requested" }, now) };
}

/**
 * Pause stops only the next step: a running step finishes, then the run is paused. A suspended binding or a disabled
 * plugin pauses the same way, with its reason; the first reason stays until the run resumes.
 */
export function pause(run: WorkflowRun, now: number, reason: PauseReason = { kind: "user", detail: null }): Result {
  if (terminal(run)) return fail("run-terminal");
  const busy = run.steps.some(step => step.state === "running" || step.state === "waiting-human");
  const pauseReason = run.pauseReason ?? pauseReasonSchema.parse(reason);
  const cause = BINDING_REASONS.find(item => item === pauseReason.detail) ?? null;
  const blockedReason = pauseReason.kind === "binding-suspended" ? { kind: "binding-suspended" as const, provider: null, role: null, cause, action: null, failure: null, extractor: null } : run.blockedReason;
  return { ok: true, run: touch(busy ? { ...run, pauseRequested: true, pauseReason, blockedReason } : { ...run, state: "paused", pauseReason, blockedReason }, now) };
}

/**
 * A pause that must not leave a question open (archive: the archived Project refuses the answer). An unanswered confirmation
 * is withdrawn — its attempt ends with the pause's detail and the confirmation is closed but kept in history, so no late answer
 * lands and nothing reminds or expires — its step goes back to pending and the run pauses now with this reason; Continue later asks
 * again from a fresh proposal and clock. With no confirmation open it is an ordinary pause.
 */
export function pauseWithdrawingConfirmation(run: WorkflowRun, now: number, reason: PauseReason): Result {
  const pending = run.state === "waiting-human" ? run.confirmations.find(item => !item.decision && item.expiredAt === null) : undefined;
  if (!pending) return pause(run, now, reason);
  const steps = run.steps.map(step => step.stepId !== pending.stepId ? step : { ...step, state: "pending" as const,
    attempts: step.attempts.map(item => item.outcome === "open" ? { ...item, outcome: "blocked" as const, settledAt: now, detail: reason.detail ?? "paused" } : item) });
  return { ok: true, run: touch({ ...run, steps, state: "paused", pauseRequested: false, pauseReason: pauseReasonSchema.parse(reason),
    confirmations: run.confirmations.map(item => item === pending ? { ...item, expiredAt: now } : item) }, now) };
}

/** A pause held for `from` (a Project's archive) becomes `to` once that cause is gone; any other pause is left as it is. */
export function restatePause(run: WorkflowRun, from: PauseReason, to: PauseReason, now: number): Result {
  const held = run.state === "paused" || run.pauseRequested;
  if (!held || run.pauseReason?.kind !== from.kind || run.pauseReason.detail !== from.detail) return { ok: true, run };
  return { ok: true, run: touch({ ...run, pauseReason: pauseReasonSchema.parse(to) }, now) };
}

/** The next writing step waits for the run holding the workspace (null: it no longer waits). */
export function waitForWorkspace(run: WorkflowRun, heldByRunId: string | null, now: number): Result {
  if (terminal(run)) return fail("run-terminal");
  if ((run.workspaceWait?.heldByRunId ?? null) === heldByRunId) return { ok: true, run };
  return { ok: true, run: touch({ ...run, workspaceWait: heldByRunId ? { heldByRunId, since: now } : null }, now) };
}

/** The record's relevant input read again (it changed): the read step's output becomes the fresh read, so later digests bind to it. */
export function refreshRead(run: WorkflowRun, readStepId: string, fresh: unknown, now: number): Result {
  if (terminal(run)) return fail("run-terminal");
  const index = run.steps.findIndex(step => step.stepId === readStepId);
  if (index < 0) return fail("unknown-step");
  return { ok: true, run: touch({ ...run, steps: run.steps.map((step, i) => i === index ? { ...step, output: fresh as z.infer<typeof json> } : step) }, now) };
}

/**
 * The input a waiting confirmation was about changed. The confirmation is withdrawn (its attempt ends `input-changed`) and the
 * step goes back to pending, so the run asks again from the record as it is now; nothing already decided changes.
 */
export function supersedeConfirmation(run: WorkflowRun, stepId: string, now: number): Result {
  const pending = openConfirmation(run, stepId);
  if (!pending) return fail("not-waiting");
  const steps = run.steps.map(step => step.stepId !== stepId ? step : { ...step, state: "pending" as const,
    attempts: step.attempts.map(item => item.outcome === "open" ? { ...item, outcome: "blocked" as const, settledAt: now, detail: "input-changed" } : item) });
  return { ok: true, run: touch({ ...run, steps, state: "running", confirmations: run.confirmations.filter(item => item !== pending) }, now) };
}

/** A retry found the cause not fixed: the blocked step keeps its attempts and states the reason as it is now. */
export function restateBlocked(run: WorkflowRun, stepId: string, reason: BlockedReason, now: number): Result {
  const step = run.steps.find(item => item.stepId === stepId);
  if (!step || step.state !== "blocked") return fail("not-running");
  return { ok: true, run: touch({ ...run, blockedReason: reason, steps: run.steps.map(item => item === step ? { ...item, blockedReason: reason } : item) }, now) };
}
/** Resume continues a paused run; the host re-checks the binding and the plugin first, so a still-suspended run stays paused. */
export function resume(run: WorkflowRun, now: number): Result {
  if (run.state !== "paused") return fail("not-paused");
  const blocked = run.steps.find(step => step.state === "blocked");
  return { ok: true, run: touch({ ...run, state: blocked ? "blocked" : "running", pauseReason: null, blockedReason: blocked?.blockedReason ?? null }, now) };
}
/** An attempt whose cleanup outcome is unknown may still have a process running for its request. */
export const mayStillRun = (step: WorkflowRun["steps"][number]) => {
  const last = step.attempts.at(-1);
  return step.state === "running" || (last?.outcome === "unknown" && last.requestId !== null);
};
/**
 * Cancel closes dispatch at once; a running step, or one whose last attempt's cleanup is unknown, is proven stopped by the
 * executor and the run is cancelled only then.
 */
export function cancel(run: WorkflowRun, now: number): Result {
  if (terminal(run)) return fail("run-terminal");
  const busy = run.steps.some(mayStillRun);
  /* A pending confirmation closes with the run: its open attempt settles as not answered, so no late answer lands. */
  const steps = run.steps.map(step => step.state === "pending" ? { ...step, state: "not-run" as const } : step.state === "waiting-human" ? { ...step, state: "not-run" as const,
    attempts: step.attempts.map(item => item.outcome === "open" ? { ...item, outcome: "failed" as const, settledAt: now, detail: "cancelled" } : item) } : step);
  return { ok: true, run: touch({ ...run, steps, state: busy ? "cancelling" : "cancelled", businessOutcome: "cancelled", cancelRequestedAt: run.cancelRequestedAt ?? now }, now) };
}
/**
 * Force stop: after a cancel that did not settle, the process group was killed. What the running step did is not
 * known, so its attempt is `unknown` and the run ends cancelled with `forcedStop`; the person is told to check the workspace.
 */
/** Force stop, or an ordinary cancel whose cleanup failed, could not confirm the process tree gone: nothing reads as stopped until it can, and Force stop stays offered. */
export function forceStopUnconfirmed(run: WorkflowRun, now: number, groups: WorkflowRun["forceStopGroups"] = []): Result {
  if (run.state !== "cancelling") return fail("not-running");
  return { ok: true, run: touch({ ...run, forceStopUnconfirmedAt: now, forceStopGroups: structuredClone(groups) }, now) };
}

/** How a cancelling run was proven stopped: by Force stop (at once, or by the startup that verified its groups), or an ordinary cancel whose turn custody proved ended. */
export type StopProof = "force-stopped" | "force-stopped-confirmed-at-startup" | "cancel-confirmed" | "cancel-confirmed-at-startup";
/** `detail` says where the stop was confirmed; only a Force stop marks the run `forcedStop`. */
export function forceStop(run: WorkflowRun, now: number, detail: StopProof = "force-stopped"): Result {
  if (run.state !== "cancelling") return fail("not-running");
  const steps = run.steps.map(step => step.state === "running" ? { ...step, state: "blocked" as const,
    attempts: step.attempts.map(item => item.outcome === "open" ? { ...item, outcome: "unknown" as const, settledAt: now, detail } : item) }
    : step.state === "pending" ? { ...step, state: "not-run" as const } : step);
  return { ok: true, run: touch({ ...run, steps, state: "cancelled", forcedStop: detail.startsWith("force"), forceStopUnconfirmedAt: null, forceStopGroups: [] }, now) };
}
