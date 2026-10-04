/**
 * [INPUT]: Depends on DurableJson, node:fs, the workflow run state machine and the binding store; the host supplies the clock, ids, the Agent-configuration freezer and the verified operator.
 * [OUTPUT]: Provides WorkflowRunLedger (with WorkflowLedgerError; confirm checks the current input witness, A-02): start a run for one record of an enabled binding, offer a rework draft and start the chosen rework (Q1), apply the run transitions durably, list and read runs, tell onWritten listeners after each durable write (the cloud projection's outbox), and forget a finished run whose Project is gone; one file per run, rebuilt into the active-run index at startup, with interrupted attempts recorded as unknown. pauseWithdrawingConfirmation (A2-03) and restatePause (V-02).
 * Freeze receives the role and Project so resource admission precedes run creation.
 * [POS]: workflows' run truth on the Project's computer (06 §6, §8). Dispatch into Chats and the Base ports, and the confirmation surfaces, sit on top of it (TASK-17 next part).
 */
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { WORKFLOW_ROLES, type WorkflowRecipe } from "@ai-chat/cloud-protocol/contracts/workflow/recipe";
import { beginStep, cancel, recordDispatch, refreshRead, supersedeConfirmation, waitForWorkspace, confirm, countExtraction, createRun, expireConfirmation, forceStop, forceStopUnconfirmed, pause, pauseWithdrawingConfirmation, remindConfirmation, restatePause, restateBlocked, type BlockedReason, recordReport, requestConfirmation, resume, settleStep, TERMINAL_RUN_STATES, workflowRunSchema,
  type StepReport,
  type ConfirmInput, type PauseReason, type ReworkStart, type VerifiedOperator, type WorkflowRun } from "@ai-chat/cloud-protocol/contracts/workflow/run";
import { readWitness, reworkDraft, sameWitness, reworkStart, type FieldWitness, type FreshRead } from "@ai-chat/cloud-protocol/contracts/workflow/rework";
import { DurableJson } from "../persistence/durable-json";
import type { WorkflowBindingStore } from "./bindings";

/* Terminal runs kept on disk; older ones are removed so the ledger stays bounded (F14). */
export const KEPT_TERMINAL_RUNS = 200;
export type LedgerPorts = {
  now(): number;
  newId(): string;
  /** Resolves a configuration's latest revision once for a run (A5); a refusal names why. */
  freezeConfig(configId: string, role?: "plan" | "develop" | "review", projectId?: string): { ok: true; frozen: unknown } | { ok: false; reason: string };
  recipe(recipeId: string, version: number): WorkflowRecipe | null;
};
type Record_ = WorkflowRun["record"];
const recordKey = (record: Record_) => `${record.base.ownerKey}\u0000${record.base.ownerInstanceId}\u0000${record.rowId}`;
const isTerminal = (run: WorkflowRun) => (TERMINAL_RUN_STATES as readonly string[]).includes(run.state);
export class WorkflowLedgerError extends Error {
  constructor(readonly code: string, readonly detail: Readonly<Record<string, unknown>> = {}) { super(code); }
}

export class WorkflowRunLedger {
  private readonly files = new Map<string, DurableJson<WorkflowRun>>();
  private readonly active = new Map<string, string>();
  private starting: Promise<unknown> = Promise.resolve();
  private readonly written = new Set<(runId: string) => void>();
  constructor(private readonly root: string, private readonly bindings: WorkflowBindingStore, private readonly ports: LedgerPorts) {}
  private path(runId: string) { return join(this.root, "runs", `${runId}.json`); }

  /**
   * Loads every run file and rebuilds the active index from them — the files are the only truth. A step that was running
   * when the app stopped is not claimed either way: its attempt becomes `unknown` and the run waits blocked (F15).
   */
  async initialize() {
    const names = await readdir(join(this.root, "runs")).catch(() => [] as string[]);
    for (const name of names.filter(item => item.endsWith(".json"))) {
      /* The file was just listed, so the empty value is never used; a corrupt file follows DurableJson's recovery policy. */
      const runId = name.slice(0, -5), file = new DurableJson(this.path(runId), workflowRunSchema, () => null as unknown as WorkflowRun);
      await file.initialize();
      if (!file.snapshot()) { await file.closeAndFlush(); continue; }
      this.files.set(runId, file);
      const run = file.snapshot();
      /* A cancelling run keeps its open step: only the runtime's custody check may call it stopped (never an interrupt, A-01). */
      if (run.state !== "cancelling") for (const step of run.steps) {
        const open = step.attempts.at(-1);
        if (step.state === "running" && open?.outcome === "open") {
          await this.write(runId, current => settleStep(current, step.stepId, open.attemptId, "unknown", null, this.ports.now(), "interrupted"));
        }
      }
      const loaded = file.snapshot();
      if (!isTerminal(loaded)) {
        const key = recordKey(loaded.record), other = this.active.get(key);
        if (other) throw new WorkflowLedgerError("workflow-ledger-two-active-runs", { runId, other });
        this.active.set(key, runId);
      }
    }
    await this.prune();
  }
  async closeAndFlush() { await Promise.all([...this.files.values()].map(file => file.closeAndFlush())); }

  /** After a run is created or a transition is durable; listeners read the run themselves. */
  onWritten(listener: (runId: string) => void) { this.written.add(listener); return () => { this.written.delete(listener); }; }
  private tell(runId: string) { for (const listener of this.written) listener(runId); }
  get(runId: string) { return this.files.get(runId)?.snapshot() ?? null; }
  list() { return [...this.files.values()].map(file => file.snapshot()).sort((a, b) => b.createdAt - a.createdAt); }
  activeFor(record: Record_) { const runId = this.active.get(recordKey(record)); return runId ? this.get(runId) : null; }

  /**
   * Starts a run on one record of an enabled binding (F4). One active run per record: a second start answers with the
   * running one instead of competing (F5). The recipe version, binding revision, each role's latest configuration and the
   * inputs are frozen into the run file before anything runs (F6).
   */
  start(input: { bindingId: string; rowId: string; inputs: Record<string, string> }) {
    return this.serial(() => this.open(input.bindingId, input.rowId, input.inputs, null));
  }
  /** The draft a rework request offers, from the record as it is now (Q1); `current` is a fresh base.read witness. */
  reworkDraft(previousRunId: string, current: FieldWitness) {
    const previous = this.get(previousRunId);
    const draft = previous ? reworkDraft(previous, current) : null;
    if (!draft) throw new WorkflowLedgerError("workflow-rework-not-requested");
    return draft;
  }
  /**
   * Rework (Q17/Q1) is a new run: it keeps the accepted plan and starts at `reworkFrom` only when the fresh witness shows
   * no change, otherwise it replans; the run that asked for it stays cancelled (F9), and one request starts one run.
   */
  startRework(previousRunId: string, choice: "keep-plan" | "replan", fresh: FreshRead) {
    return this.serial(() => {
      const previous = this.get(previousRunId);
      const draft = previous ? reworkDraft(previous, fresh.witness) : null;
      if (!previous || !draft) throw new WorkflowLedgerError("workflow-rework-not-requested");
      if (this.list().some(run => run.previousRunId === previousRunId)) throw new WorkflowLedgerError("workflow-rework-started");
      const start = reworkStart(previous, draft, choice, fresh);
      if (!start) throw new WorkflowLedgerError("workflow-rework-choice-unavailable", { choice, reason: draft.reason });
      return this.open(previous.bindingId, previous.record.rowId, previous.inputs, { start, recipe: previous.recipe });
    });
  }

  beginStep(runId: string, stepId: string) { return this.write(runId, run => beginStep(run, stepId, this.ports.newId(), this.ports.now())); }
  settleStep(runId: string, stepId: string, attemptId: string, outcome: "succeeded" | "failed" | "blocked" | "unknown", output: unknown, detail: string | null = null,
    blockedReason: BlockedReason | null = null) {
    return this.write(runId, run => settleStep(run, stepId, attemptId, outcome, output, this.ports.now(), detail, blockedReason));
  }
  /* The confirmation clock passes the wall-clock time it judged by, so the record and the decision agree. */
  remindConfirmation(runId: string, stepId: string, reminder: "started" | "final-hour", at: number) { return this.write(runId, run => remindConfirmation(run, stepId, reminder, at)); }
  expireConfirmation(runId: string, stepId: string, at: number) { return this.write(runId, run => expireConfirmation(run, stepId, at)); }
  restateBlocked(runId: string, stepId: string, reason: BlockedReason) { return this.write(runId, run => restateBlocked(run, stepId, reason, this.ports.now())); }
  /** An agent step's report, recorded on its current attempt; the step settles later, at the executor's latch (W7, W8). */
  recordReport(runId: string, stepId: string, attemptId: string, report: StepReport, digest: string, derived = false) {
    return this.write(runId, run => recordReport(run, stepId, attemptId, report, digest, this.ports.now(), derived));
  }
  countExtraction(runId: string, stepId: string, attemptId: string) { return this.write(runId, run => countExtraction(run, stepId, attemptId, this.ports.now())); }
  requestConfirmation(runId: string, stepId: string, proposalDigest: string) {
    return this.write(runId, run => requestConfirmation(run, stepId, proposalDigest, this.ports.now()));
  }
  /** The operator is the verified session the host passes in; nothing in `input` can name one (F10). */
  /**
   * `current` (A-02) reads the record's relevant input as it is now, inside the same write as the decision: when it differs from
   * what the run read, the decision is refused with `input-changed` and nothing is recorded.
   */
  confirm(runId: string, stepId: string, input: ConfirmInput, operator: VerifiedOperator, current?: () => FieldWitness | null) {
    return this.write(runId, run => current && !sameWitness(readWitness(run), current())
      ? { ok: false as const, code: "input-changed" } : confirm(run, stepId, input, operator, this.ports.now()));
  }
  pause(runId: string, reason?: PauseReason) { return this.write(runId, run => pause(run, this.ports.now(), reason)); }
  /** A2-03: pause now, withdrawing an unanswered confirmation (kept in history) rather than waiting on it. */
  pauseWithdrawingConfirmation(runId: string, reason: PauseReason) { return this.write(runId, run => pauseWithdrawingConfirmation(run, this.ports.now(), reason)); }
  /** V-02: a pause held for `from` becomes `to`; any other pause stays. */
  restatePause(runId: string, from: PauseReason, to: PauseReason) { return this.write(runId, run => restatePause(run, from, to, this.ports.now())); }
  resume(runId: string) { return this.write(runId, run => resume(run, this.ports.now())); }
  cancel(runId: string) { return this.write(runId, run => cancel(run, this.ports.now())); }
  /** Q20: a cancel that did not settle; the running attempt becomes unknown and the run ends cancelled with forcedStop. */
  forceStop(runId: string, detail?: Parameters<typeof forceStop>[2]) { return this.write(runId, run => forceStop(run, this.ports.now(), detail)); }
  forceStopUnconfirmed(runId: string, groups: WorkflowRun["forceStopGroups"]) { return this.write(runId, run => forceStopUnconfirmed(run, this.ports.now(), groups)); }
  /** Runs a previous launch left with an unconfirmed Force stop, for the runtime to verify by their recorded process groups. */
  /** Runs a previous launch left cancelling: their stop is settled at startup only on custody's evidence. */
  cancellingRuns() { return this.list().filter(run => run.state === "cancelling"); }
  refreshRead(runId: string, readStepId: string, fresh: FreshRead) { return this.write(runId, run => refreshRead(run, readStepId, fresh, this.ports.now())); }
  supersedeConfirmation(runId: string, stepId: string) { return this.write(runId, run => supersedeConfirmation(run, stepId, this.ports.now())); }
  waitForWorkspace(runId: string, heldByRunId: string | null) { return this.write(runId, run => waitForWorkspace(run, heldByRunId, this.ports.now())); }
  recordDispatch(runId: string, stepId: string, attemptId: string, requestId: string) {
    return this.write(runId, run => recordDispatch(run, stepId, attemptId, requestId, this.ports.now()));
  }

  private async open(bindingId: string, rowId: string, inputs: Record<string, string>,
    rework: { start: ReworkStart; recipe: WorkflowRecipe } | null) {
    const binding = this.bindings.get(bindingId);
    if (!binding) throw new WorkflowLedgerError("workflow-binding-not-found");
    if (binding.state !== "enabled") throw new WorkflowLedgerError("workflow-binding-not-enabled", { state: binding.state, reason: binding.suspendedReason });
    const record = { base: binding.base.base, rowId };
    const running = this.activeFor(record);
    if (running) return { started: false as const, run: running };
    const recipe = rework?.recipe ?? this.ports.recipe(binding.recipe.recipeId, binding.recipe.version);
    if (!recipe) throw new WorkflowLedgerError("workflow-recipe-unavailable");
    const configs: Record<string, unknown> = {};
    for (const role of WORKFLOW_ROLES) {
      const frozen = this.ports.freezeConfig(binding.roles[role].configId, role, binding.projectId);
      if (!frozen.ok) throw new WorkflowLedgerError("workflow-config-refused", { role, reason: frozen.reason });
      configs[role] = frozen.frozen;
    }
    const runId = this.ports.newId();
    const created = createRun({ runId, bindingId, bindingRevision: binding.revision, record, recipe, configs, inputs, now: this.ports.now(),
      ...(rework ? { rework: rework.start } : {}) });
    if (!created.ok) throw new WorkflowLedgerError(created.code);
    const file = new DurableJson(this.path(runId), workflowRunSchema, () => created.run);
    await file.initialize();
    this.files.set(runId, file);
    this.active.set(recordKey(record), runId);
    this.tell(runId);
    return { started: true as const, run: created.run };
  }

  private async write<T extends { ok: true; run: WorkflowRun } | { ok: false; code: string }>(runId: string, transition: (run: WorkflowRun) => T) {
    const file = this.files.get(runId);
    if (!file) throw new WorkflowLedgerError("workflow-run-not-found");
    const result = await file.mutate(run => {
      const next = transition(structuredClone(run));
      if (!next.ok) throw new WorkflowLedgerError(next.code);
      Object.assign(run, next.run);
      return next as Extract<T, { ok: true }>;
    });
    const run = file.snapshot();
    this.tell(runId);
    if (isTerminal(run)) { this.active.delete(recordKey(run.record)); await this.prune(); }
    return result;
  }
  private serial<T>(work: () => Promise<T> | T): Promise<T> {
    const next = this.starting.then(work, work);
    this.starting = next.catch(() => undefined);
    return next;
  }
  /** Forgets a finished run with its Project (deleted or removed). A run not finished is never forgotten: its process may still run. */
  async forget(runId: string) {
    const file = this.files.get(runId);
    if (!file) return;
    if (!isTerminal(file.snapshot())) throw new WorkflowLedgerError("workflow-run-not-finished");
    this.files.delete(runId);
    await file.closeAndFlush();
    await rm(this.path(runId), { force: true });
  }
  private async prune() {
    const terminal = this.list().filter(isTerminal);
    for (const run of terminal.slice(KEPT_TERMINAL_RUNS)) {
      const file = this.files.get(run.runId)!;
      this.files.delete(run.runId);
      await file.closeAndFlush();
      await rm(this.path(run.runId), { force: true });
    }
  }
}
