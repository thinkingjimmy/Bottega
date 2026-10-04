/**
 * [INPUT]: Depends on its sibling modules (types, reasons, report-repair, step-evidence, confirmation-clock, custody), the run ledger and binding store, the recipe/run/rework contracts, runBaseAction, the workflow turn policy and a StepResultIntake, and ports for agent dispatch, role admission, plugin state and the clock.
 * [OUTPUT]: Provides WorkflowExecutor: advance(runId) drives a run to its next wait (app.call inline under the run owner's own Workflow run principal for that step attempt, human.confirm → a confirmation bound to its proposal digest, agent.run → one dispatched turn owing one report, dispatched with its 1-based attempt number); turnSettled() closes an agent step only through the latch; suspend() pauses a binding's runs after their current step.
 * Each dispatched role carries its frozen Skill/MCP digests in main-owned turn policy.
 *           confirm (A-02: only against the record as it is now), pauseForWorkflowPlugin (A-04) and the workspace writer lease with recoverWorkspaceLeases (A-07; A2-02: only runnable waiters are woken, and no run ever awaits its own flight, so a paused waiter cannot wedge settlement, Cancel, recovery or quit).
 *           Cancellation settles only on evidence (review-0926 F1): steps still starting are tracked, the turn's request id is durable before it is sent, and recoverCancellations / Force stop ask processOf (the launch identity custody holds). A2-01: a Cancel with no step running but an attempt whose cleanup is unknown is settled from custody at once, and mayStillRun(runId) is the proof Project removal asks for. A2-04: a turn's message is assembled by runtime/turn/step-message.ts; an input handed by file makes the evidence store a read-only root of that turn.
 * [POS]: The engine of TASK-17 2.4 (06 §4–§8), the class of workflows/executor: its port types live in types.ts, and report repair, review evidence, the confirmation clock and evidence-only stop settlement in their sibling modules. Every effect follows its durable intent; nothing here starts ACP or picks an operator; dispatch goes through the Chat machinery behind the AgentDispatch port (composed in 2.6).
 * Dispatch also freezes explicit readonly Memory intent, task-only query and a step admission timestamp.
 */
import type { WorkflowRoleName } from "@ai-chat/cloud-protocol/contracts/workflow/recipe";
import { proposalDigest, readWitness, sameWitness, type FieldWitness, type FreshRead } from "@ai-chat/cloud-protocol/contracts/workflow/rework";
import type { ConfirmInput, VerifiedOperator } from "@ai-chat/cloud-protocol/contracts/workflow/run";
import { MAX_ATTEMPTS, type BlockedReason, type PauseReason, type StopProof, type WorkflowRun } from "@ai-chat/cloud-protocol/contracts/workflow/run";
import { checkBaseRecord, runBaseAction } from "../base-actions";
import { WorkflowLedgerError } from "../ledger";
import { canonicalWorkspace } from "../runtime/workspace-leases";
import { clearWorkflowTurnPolicy, setWorkflowTurnPolicy } from "../turn-policy";
import { turnNetworkOff, turnReadOnly, type FrozenLike } from "../runtime/turn/effective-config";
import { assembleStepMessage } from "../runtime/turn/step-message";
import { workflowRunPrincipal } from "../../operations/principals";
import { reviewEvidenceSection } from "../evidence";
import { checkConfirmationClock, nextConfirmationDue } from "./confirmation-clock";
import { settleFromCustody, settleUnconfirmed } from "./custody";
import { baseActionReason, providerOf, resolved } from "./reasons";
import { repairReport } from "./report-repair";
import { developEvidence, recordEvidence } from "./step-evidence";
import type { ExecutorPorts, SettledTurn, StepEvidence, Turn } from "./types";

export type { AgentDispatch, ExecutorPorts, SettledTurn } from "./types";

export class WorkflowExecutor {
  private readonly turns = new Map<string, Turn>();
  /* Agent steps between their durable intent and a registered turn (admission, evidence, dispatch): nothing there is stoppable
     yet, so Force stop cannot read the run as stopped while one is in flight (A-09). */
  private readonly starting = new Map<string, Promise<unknown>>();
  /* Runs whose Force stop is killing their turns: the killed turn's own settlement must not write an ordinary cancel over it. */
  private readonly forceStopping = new Set<string>();
  private readonly flights = new Map<string, Promise<void>>();
  /* Runs whose queued retry is being replayed: two lease passes at once must not dispatch it twice (D3-01). */
  private readonly replaying = new Set<string>();
  constructor(private readonly ports: ExecutorPorts) {}

  /** Serialised per run; a call while one is in flight waits for it and then looks again. */
  advance(runId: string): Promise<void> {
    const previous = this.flights.get(runId) ?? Promise.resolve();
    const next = previous.then(() => this.step(runId), () => this.step(runId));
    /* The chain entry is only ever followed (then/catch above), so its own rejection is not an unhandled one; the caller gets `next`. */
    const tracked = next.finally(() => { if (this.flights.get(runId) === tracked) this.flights.delete(runId); });
    tracked.catch(() => undefined);
    this.flights.set(runId, tracked);
    return next;
  }

  private async step(runId: string): Promise<void> {
    const before = this.ports.ledger.get(runId)?.revision;
    await this.stepUntilWait(runId);
    await this.settleLeases(runId, this.ports.ledger.get(runId)?.revision !== before);
  }

  private async stepUntilWait(runId: string): Promise<void> {
    for (;;) {
      const run = this.ports.ledger.get(runId);
      if (!run || !["queued", "running", "blocked"].includes(run.state) || run.pauseRequested) return;
      /* A step in flight, waiting for a person, or blocked holds the run: blocked steps move only by an explicit check (advanceBlocked). */
      if (run.steps.some(step => step.state === "running" || step.state === "waiting-human" || step.state === "blocked")) return;
      const next = run.steps.find(step => step.state === "pending");
      if (!next) return;
      /* A-04: with the Workflow plugin off no step starts; the run pauses with the reason instead. */
      if (!this.ports.workflowEnabled()) { await this.ports.ledger.pause(runId, { kind: "plugin-disabled", detail: "workflow" }); return; }
      if (await this.execute(run, next.stepId) === "wait") return;
    }
  }

  /** Begins one step (its durable intent) and runs it: "continue" when it settled inline, "wait" for a person, a turn or a block. */
  private execute(run: WorkflowRun, stepId: string): Promise<"continue" | "wait"> {
    if (run.recipe.steps.find(step => step.id === stepId)?.kind !== "agent.run") return this.executeStep(run, stepId);
    const flight = this.executeStep(run, stepId);
    this.starting.set(run.runId, flight);
    return flight.finally(() => { if (this.starting.get(run.runId) === flight) this.starting.delete(run.runId); });
  }

  private async executeStep(run: WorkflowRun, stepId: string): Promise<"continue" | "wait"> {
    const runId = run.runId, recipeStep = run.recipe.steps.find(step => step.id === stepId)!;
    const binding = this.ports.bindings.get(run.bindingId);
    if (!binding || binding.state !== "enabled") {
      await this.ports.ledger.pause(runId, { kind: "binding-suspended", detail: binding?.suspendedReason ?? "binding-missing" });
      return "wait";
    }
    const step = run.steps.find(item => item.stepId === stepId)!;
    if (step.attempts.length >= MAX_ATTEMPTS) {
      await this.ports.ledger.restateBlocked(runId, stepId, { kind: "attempts-exhausted", provider: null, role: recipeStep.kind === "agent.run" ? recipeStep.role : null,
        cause: null, action: null, failure: null, extractor: null });
      return "wait";
    }
    /* A-07: a writing step starts only while its run holds the workspace's writer lease; another writer queues, spending no attempt. */
    if (recipeStep.kind === "agent.run" && !turnReadOnly(recipeStep.role, (run.configs[recipeStep.role] as FrozenLike | undefined)?.guarantees)) {
      const key = this.workspaceKey(run);
      const held = key ? await this.ports.leases.acquire(key, runId, stepId, Date.now()) : true;
      if (held !== true) { await this.ports.ledger.waitForWorkspace(runId, held); return "wait"; }
      if (run.workspaceWait) await this.ports.ledger.waitForWorkspace(runId, null);
    }
    const begun = await this.ports.ledger.beginStep(runId, stepId);
    const attemptId = begun.run.steps.find(step => step.stepId === stepId)!.attempts.at(-1)!.attemptId;
    const args = resolved(begun.run, recipeStep.inputs);
    if (recipeStep.kind === "app.call") {
      try {
        const output = await runBaseAction({ step: recipeStep, args, binding: binding.base, recipe: begun.run.recipe, rowId: run.record.rowId, principal: this.runPrincipal(runId, stepId, attemptId), ports: this.ports.base });
        await this.ports.ledger.settleStep(runId, stepId, attemptId, "succeeded", output);
        return "continue";
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        await this.ports.ledger.settleStep(runId, stepId, attemptId, "blocked", null, detail.slice(0, 512), baseActionReason(recipeStep.action, cause));
        if (detail.startsWith("workflow-binding-suspended:")) await this.suspendBinding(binding.bindingId, detail.split(":")[1]!);
        return "wait";
      }
    }
    if (recipeStep.kind === "human.confirm") {
      /* A-02: a confirmation is always asked about the record as it is now — after a rework, a 24-hour expiry or a changed input. */
      const read = begun.run.recipe.steps.find(item => item.kind === "app.call" && item.action === "base.read");
      let current = begun.run;
      if (read?.kind === "app.call") {
        try {
          const fresh = await runBaseAction({ step: read, args: {}, binding: binding.base, recipe: begun.run.recipe, rowId: run.record.rowId, principal: this.runPrincipal(runId, stepId, attemptId), ports: this.ports.base }) as FreshRead;
          if (!sameWitness(readWitness(current), fresh.witness)) current = (await this.ports.ledger.refreshRead(runId, read.id, fresh)).run;
        } catch (cause) {
          await this.ports.ledger.settleStep(runId, stepId, attemptId, "blocked", null, (cause instanceof Error ? cause.message : String(cause)).slice(0, 512), baseActionReason(read.action, cause));
          return "wait";
        }
      }
      await this.ports.ledger.requestConfirmation(runId, stepId, proposalDigest(current, String(resolved(current, recipeStep.inputs).proposal ?? "")));
      return "wait";
    }
    const config = begun.run.configs[recipeStep.role];
    const refused = await this.admission(recipeStep.role, config, run);
    if (refused) {
      await this.ports.ledger.settleStep(runId, stepId, attemptId, "blocked", null, `workflow-role-not-admitted:${refused.kind}`, refused);
      return "wait";
    }
    await this.dispatch(begun.run, recipeStep.id, recipeStep.role, attemptId, args, config);
    return "wait";
  }

  private async dispatch(run: WorkflowRun, stepId: string, role: WorkflowRoleName, attemptId: string, args: Record<string, unknown>, config: unknown) {
    const requestId = this.ports.newRequestId();
    /* The policy and the expected report exist before the turn does: the turn's context and its tool lease read them at start. */
    /* Review also reads the run's evidence, from a host directory outside the workspace that it cannot write (W16). */
    const developChat = role === "review" ? this.ports.chatOf(run.record, "develop") : null;
    /* AGT-06 (a): the frozen effective Base scope; a config frozen without one reads only (the cap fails closed). */
    const guarantees = (config as FrozenLike | undefined)?.guarantees, base = (config as FrozenLike | undefined)?.scope?.effective?.tools?.base;
    const memory = (config as FrozenLike | undefined)?.scope?.effective?.memory;
    const workflowMemoryRead = (config as FrozenLike | undefined)?.resolved?.fields?.memory?.mode === "explicit" && memory?.read === true && memory.write === false;
    const recallQuery = [args.task, args.acceptanceCriteria].filter(value => typeof value === "string").join("\n");
    const policy = { workflowMemoryRead, recallQuery, admittedAt: Date.now(), readOnly: turnReadOnly(role, guarantees), ...(turnNetworkOff(guarantees) ? { networkOff: true } : {}), ...(developChat ? { historyChatId: developChat } : {}),
      ...(base ? { base } : {}), resources: (config as FrozenLike | undefined)?.resources };
    setWorkflowTurnPolicy(requestId, { ...policy, ...(role === "review" ? { readOnlyRoots: [this.ports.evidence.directory] } : {}) });
    try {
      /* The reviewer runs nothing itself: it is handed what the host recorded after development, read-only (W16). */
      /* A-10 / A2-04: the whole turn text (instructions, prompt, prior results, evidence) fits one Chat message; what does not is handed by file. */
      const instructions = (config as FrozenLike | undefined)?.resolved?.fields?.instructions?.value;
      const { prompt, handed } = await assembleStepMessage({ role, args, instructions: typeof instructions === "string" && instructions ? instructions : null,
        store: this.ports.evidence,
        ...(role === "review" ? { evidence: (budget: number) => reviewEvidenceSection(...developEvidence(run), this.ports.evidence, budget) } : {}) });
      /* A handed input is read from the store, read-only, by whichever role it was handed to. */
      if (handed) setWorkflowTurnPolicy(requestId, { ...policy, readOnlyRoots: [this.ports.evidence.directory] });
      /* Admission and evidence were awaited: the run may have been cancelled meanwhile, and then nothing may start (A-09). */
      if (!this.stillOpen(run.runId, stepId, attemptId)) {
        clearWorkflowTurnPolicy(requestId);
        if (this.ports.ledger.get(run.runId)?.state === "cancelling") {
          await this.ports.ledger.settleStep(run.runId, stepId, attemptId, "blocked", null, "cancelled-before-dispatch");
        }
        return;
      }
      await this.ports.ledger.recordDispatch(run.runId, stepId, attemptId, requestId);
      const attempt = run.steps.find(step => step.stepId === stepId)!.attempts.findIndex(entry => entry.attemptId === attemptId) + 1;
      const chat = await this.ports.agent.dispatch({ runId: run.runId, stepId, role, record: run.record, attempt, requestId, prompt,
        task: typeof args.task === "string" ? args.task : "", config });
      this.turns.set(requestId, { runId: run.runId, stepId, role, attemptId, ...chat });
      this.ports.intake.expect(requestId, { runId: run.runId, stepId, attemptId, ...chat });
      /* A cancel that landed while it was being sent found no turn to stop: the turn that won the race is stopped now. */
      if (this.ports.ledger.get(run.runId)?.state === "cancelling") await this.ports.agent.stop(requestId);
    } catch (cause) {
      clearWorkflowTurnPolicy(requestId);
      await this.ports.ledger.settleStep(run.runId, stepId, attemptId, "blocked", null, `workflow-dispatch-failed:${cause instanceof Error ? cause.message : String(cause)}`.slice(0, 512),
        { kind: "dispatch-failed", provider: providerOf(config), role, cause: null, action: null, failure: null, extractor: null });
    }
  }

  /**
   * O4 (W7): this run's own authority for one step attempt, minted from the ledger's state — the attempt's 1-based number
   * within its step — and alive only while that attempt is still the step's open one.
   */
  private runPrincipal(runId: string, stepId: string, attemptId: string) {
    const attempts = this.ports.ledger.get(runId)?.steps.find(step => step.stepId === stepId)?.attempts ?? [];
    const attempt = attempts.findIndex(entry => entry.attemptId === attemptId) + 1;
    if (attempt < 1) throw new Error(`workflow-attempt-unknown:${stepId}`);
    return workflowRunPrincipal({ runId, stepId, attempt }, () => this.stillOpen(runId, stepId, attemptId));
  }

  private stillOpen(runId: string, stepId: string, attemptId: string) {
    const run = this.ports.ledger.get(runId), current = run?.steps.find(step => step.stepId === stepId)?.attempts.at(-1);
    return run?.state === "running" && current?.attemptId === attemptId && current.outcome === "open";
  }

  /**
   * The latch (06 §4): a step succeeds only when its turn ended `done`, was stored, left a valid report on the current
   * attempt and finished its cleanup. A turn that ended without a report, or with an error, blocks the step with the
   * reason; a cancelled turn during a cancel settles the run as cancelled; a stale turn changes nothing (W4, W8).
   */
  async turnSettled(event: SettledTurn) {
    await this.settleTurn(event);
    await this.settleLeases();
  }

  private async settleTurn(event: SettledTurn) {
    const turn = this.turns.get(event.requestId);
    if (!turn || event.cleanup === "pending") return;
    this.turns.delete(event.requestId);
    this.ports.intake.release(event.requestId);
    clearWorkflowTurnPolicy(event.requestId);
    if (this.forceStopping.has(turn.runId)) return;
    const run = this.ports.ledger.get(turn.runId);
    const attempt = run?.steps.find(step => step.stepId === turn.stepId)?.attempts.at(-1);
    if (!run || !attempt || attempt.attemptId !== turn.attemptId || attempt.outcome !== "open") return;
    /* A cancelled turn whose cleanup failed may still run: the run stays cancelling, unconfirmed, with Force stop offered (A-01). */
    if (run.state === "cancelling" && event.cleanup === "failed") {
      const held = await this.ports.agent.processOf(event.requestId);
      if (held.state === "held") { await this.ports.ledger.forceStopUnconfirmed(turn.runId, [held.group]); return; }
    }
    let report = attempt.report;
    const clean = event.terminal === "done" && event.outcome === "stored" && event.cleanup === "complete";
    /* W9: a clean turn that submitted no report may still be repaired, without ever reopening its writable session. */
    if (clean && report === null) {
      const repaired = await this.repairReport(run, turn, attempt, event.assistantText ?? null);
      if ("blocked" in repaired) {
        await this.ports.ledger.settleStep(turn.runId, turn.stepId, turn.attemptId, "blocked", null, "no-valid-report", repaired.blocked);
        return;
      }
      report = repaired.report;
    }
    const ok = clean && report !== null;
    if (ok) {
      /* After development the host records the facts review will be handed: the code as it is now and the commands actually run. */
      const evidence: StepEvidence | null = turn.role === "develop" ? await recordEvidence(this.ports, run, event.commands) : null;
      await this.ports.ledger.settleStep(turn.runId, turn.stepId, turn.attemptId, "succeeded", { ...report, chatRef: turn.chatId, ...(evidence ? { evidence } : {}) });
      return this.advance(turn.runId);
    }
    const detail = event.terminal !== "done" ? `turn-${event.terminal}` : event.cleanup === "failed" ? "cleanup-failed" : report ? `turn-${event.outcome}` : "no-valid-report";
    await this.ports.ledger.settleStep(turn.runId, turn.stepId, turn.attemptId, event.cleanup === "failed" ? "unknown" : "blocked", null, detail,
      { kind: "no-valid-report", provider: providerOf(run.configs[turn.role]), role: turn.role, cause: null, action: null, failure: null, extractor: null });
  }

  private repairReport(run: WorkflowRun, turn: Turn, attempt: WorkflowRun["steps"][number]["attempts"][number], source: string | null) {
    return repairReport(this.ports, run, turn, attempt, source);
  }

  /**
   * Q8: a blocked step (its outcome unknown, or refused) is never re-sent on its own. After the person has checked the
   * result — its Chat is open to them — they may go on: the step runs again as a new, recorded attempt, then the run continues.
   * Invariant (D3-01): this is the only path that can give a run with a blocked step a workspace wait, so "blocked step + workspaceWait"
   * is the person's queued retry, persisted; settleLeases replays it. No other path may set a wait on a blocked step.
   */
  async advanceBlocked(runId: string) {
    const run = this.ports.ledger.get(runId);
    const blocked = run?.steps.find(step => step.state === "blocked");
    if (!run || !blocked || run.state === "paused" || run.pauseRequested) return;
    if (await this.execute(run, blocked.stepId) === "continue") await this.advance(runId);
  }

  /**
   * "Retry this step", by hand only: admission runs again first, and a new attempt begins only once the cause is fixed; otherwise
   * the step stays blocked with its reason as it is now, and no attempt is spent.
   */
  async retryStep(runId: string, stepId: string) {
    const run = this.ports.ledger.get(runId), step = run?.steps.find(item => item.stepId === stepId);
    if (!run || step?.state !== "blocked" || run.state !== "blocked") throw new Error("not-blocked");
    const recipeStep = run.recipe.steps.find(item => item.id === stepId);
    if (recipeStep?.kind === "agent.run") {
      const refused = await this.admission(recipeStep.role, run.configs[recipeStep.role], run);
      if (refused) { await this.ports.ledger.restateBlocked(runId, stepId, refused); return; }
    }
    /* A Base step's known prerequisites (the Base, the binding against it, the record) are checked before an attempt is spent (A-06). */
    if (recipeStep?.kind === "app.call") {
      const binding = this.ports.bindings.get(run.bindingId);
      const broken = binding ? checkBaseRecord(binding.base, run.record.rowId, this.ports.base) : new Error("workflow-binding-suspended:binding-missing");
      if (broken) { await this.ports.ledger.restateBlocked(runId, stepId, baseActionReason(recipeStep.action, broken)); return; }
    }
    await this.advanceBlocked(runId);
  }

  /** Why this computer cannot take the role now, or null. A run frozen without the role's configuration (the ledger comes from disk) is refused, never thrown. */
  private async admission(role: WorkflowRoleName, config: unknown, run: WorkflowRun): Promise<BlockedReason | null> {
    if (!config) return { kind: "config-unavailable", provider: null, role, cause: null, action: null, failure: null, extractor: null };
    const result = await this.ports.admit(role, config, this.ports.workspaceOf(run));
    return result.admitted ? null : { kind: result.reason, provider: providerOf(config), role, cause: null, action: null, failure: null, extractor: null,
      ...(result.guarantee ? { guarantee: result.guarantee } : {}) };
  }

  /** Q16: see confirmation-clock.ts. */
  checkConfirmationClock(now: number) { return checkConfirmationClock(this.ports, now); }
  /** When the clock next has something to do, for the runtime's single timer; null when no confirmation waits. */
  nextConfirmationDue(now: number) { return nextConfirmationDue(this.ports, now); }

  /** A confirmation landed through the bridge; continue from it. */
  confirmed(runId: string) { return this.advance(runId); }

  /**
   * A-02: a decision lands only against the record as it is now, checked inside the same write as the decision. When the task or
   * criteria changed, the waiting confirmation is withdrawn, asked again from the current input, and the caller gets `stale-proposal`.
   */
  async confirm(runId: string, stepId: string, input: ConfirmInput, operator: VerifiedOperator) {
    try {
      await this.ports.ledger.confirm(runId, stepId, input, operator, () => this.currentWitness(runId));
    } catch (cause) {
      if (!(cause instanceof WorkflowLedgerError) || cause.message !== "input-changed") throw cause;
      await this.ports.ledger.supersedeConfirmation(runId, stepId);
      await this.advance(runId);
      throw new WorkflowLedgerError("stale-proposal");
    }
    await this.advance(runId);
  }

  /** The record's task and criteria witness as the Base holds it now; null when the Base, binding or record is gone. */
  private currentWitness(runId: string): FieldWitness | null {
    const run = this.ports.ledger.get(runId), binding = run && this.ports.bindings.get(run.bindingId);
    if (!run || !binding || checkBaseRecord(binding.base, run.record.rowId, this.ports.base)) return null;
    const { base, taskNameColumnId, acceptanceCriteriaColumnId } = binding.base;
    return { task: this.ports.base.cellWitness(base, run.record.rowId, taskNameColumnId),
      acceptanceCriteria: this.ports.base.cellWitness(base, run.record.rowId, acceptanceCriteriaColumnId) };
  }

  /**
   * Cancel closes dispatch and stops the running turn; the run is cancelled when that turn settles (06 §8). With no step running
   * but an attempt whose cleanup is unknown, custody decides at once: nothing held confirms the cancel, anything held leaves it
   * unconfirmed with Force stop offered (A2-01).
   */
  async cancel(runId: string) {
    const { run } = await this.ports.ledger.cancel(runId);
    for (const [requestId, turn] of this.turns) if (turn.runId === runId) await this.ports.agent.stop(requestId);
    if (run.state === "cancelling" && !this.starting.has(runId) && !run.steps.some(step => step.state === "running")) await this.settleFromCustody(run, "cancel-confirmed");
    await this.settleLeases();
  }

  /** Whether any attempt of the run may still have a process: a running step, or an unknown outcome custody still holds (A2-01). */
  async mayStillRun(runId: string) {
    const run = this.ports.ledger.get(runId);
    if (!run) return false;
    if (run.state === "cancelling" || this.starting.has(runId)) return true;
    return (await Promise.all(run.steps.map(step => this.writerMayRun(runId, step.stepId)))).some(Boolean);
  }

  /**
   * Force stop (06 §8), only while cancelling: every open turn of the run has its process tree killed, and the run reads stopped
   * only once each tree is confirmed gone; otherwise it stays cancelling and says a process may still be running. A step still
   * being admitted or sent is not yet stoppable, so it is never read as stopped (A-09); with no live turn, only the recorded
   * groups or custody's evidence about the attempt's request can prove it.
   */
  async forceStop(runId: string) {
    try { return await this.forceStopRun(runId); } finally { await this.settleLeases(); }
  }

  private async forceStopRun(runId: string) {
    const run = this.ports.ledger.get(runId);
    if (run?.state !== "cancelling") return this.ports.ledger.forceStop(runId);
    if (this.starting.has(runId)) return this.ports.ledger.forceStopUnconfirmed(runId, [...run.forceStopGroups, null].slice(-8));
    const open = [...this.turns].filter(([, turn]) => turn.runId === runId).map(([requestId]) => requestId);
    if (!open.length) {
      return run.forceStopGroups.length ? this.settleUnconfirmed(runId, run.forceStopGroups, "force-stopped") : this.settleFromCustody(run, "force-stopped");
    }
    this.forceStopping.add(runId);
    try {
      const outcomes = await Promise.all(open.map(requestId => this.ports.agent.forceKill(requestId)));
      const survivors = outcomes.flatMap(item => item.outcome === "survived" ? [item.group] : []);
      return survivors.length ? await this.ports.ledger.forceStopUnconfirmed(runId, survivors) : await this.ports.ledger.forceStop(runId);
    } finally {
      this.forceStopping.delete(runId);
    }
  }

  /**
   * Startup (06 §8, never report stopped falsely): a run a previous launch left cancelling is stopped only on evidence. With
   * recorded groups (an unconfirmed Force stop or a failed cleanup), every group (pid + birth) must be proven ended, killing any
   * still there; otherwise custody must hold nothing for the open attempt's request. Anything else keeps the run unconfirmed
   * with Force stop offered.
   */
  async recoverCancellations() {
    for (const run of this.ports.ledger.cancellingRuns()) {
      const settling = run.forceStopGroups.length ? this.settleUnconfirmed(run.runId, run.forceStopGroups, "force-stopped-confirmed-at-startup")
        : this.settleFromCustody(run, run.forceStopUnconfirmedAt === null ? "cancel-confirmed-at-startup" : "force-stopped-confirmed-at-startup");
      await settling.catch(cause => console.warn(`[workflows] the stop of ${run.runId} could not be verified at startup`, cause));
    }
    await this.settleLeases();
  }

  /** Startup (A-07): a writer lease a previous launch left is kept only while custody still holds its writer; queued runs go on. */
  recoverWorkspaceLeases() { return this.settleLeases(); }

  private workspaceKey(run: WorkflowRun) {
    const workspace = this.ports.workspaceOf(run);
    return workspace ? canonicalWorkspace(workspace) : null;
  }

  /**
   * Releases leases no writer may still hold, then wakes the writers that were queued behind them (A-07). Only a runnable waiter is
   * woken: a paused one (a person, archive, Workflow off, a suspended binding, its Provider) stays queued until it is resumed. A2-02:
   * a waiter is awaited only when no flight of it is in progress; the run whose own step called this, and any waiter already in
   * flight, is scheduled after that flight instead, so no run ever waits on itself (which wedged recovery, Cancel and quit). D3-01: a
   * waiter whose step is blocked is woken by replaying its queued retry, and a pass that changed nothing never reschedules its own run.
   */
  private async settleLeases(fromRunId?: string, fromChanged = true) {
    let released = false;
    for (const lease of [...this.ports.leases.list()]) {
      if (!await this.writerMayRun(lease.runId, lease.stepId)) { await this.ports.leases.release(lease.key, lease.runId); released = true; }
    }
    for (const run of this.ports.ledger.list()) {
      if (!run.workspaceWait || !["queued", "running", "blocked"].includes(run.state) || run.pauseRequested) continue;
      const key = this.workspaceKey(run);
      if (key && this.ports.leases.holder(key) === run.workspaceWait.heldByRunId) continue;
      /* D3-01: a pass that changed nothing and freed no lease never reschedules its own run (it would spin in microtasks). */
      if (run.runId === fromRunId && !fromChanged && !released) continue;
      /* A waiter whose step is blocked queued by a person's retry: its next runnable step is that retry, not an ordinary pass. */
      if (run.steps.some(step => step.state === "blocked")) { await this.replayQueuedRetry(run.runId); continue; }
      if (run.runId === fromRunId || this.flights.has(run.runId)) void this.advance(run.runId).catch(() => undefined);
      else await this.advance(run.runId);
    }
  }

  /**
   * D3-01: a blocked step gains a workspace wait only through a person's "Retry this step" or "Check result" (advanceBlocked), so the
   * queue entry is that retry, persisted. Once the lease is free it is replayed exactly once, admission checked again; a retry that
   * is refused now gives up its place in the queue, since the person's request has been answered.
   */
  private async replayQueuedRetry(runId: string) {
    if (this.replaying.has(runId)) return;
    this.replaying.add(runId);
    try {
      const step = this.ports.ledger.get(runId)?.steps.find(item => item.state === "blocked");
      if (!step) return;
      await this.retryStep(runId, step.stepId).catch(cause => console.warn(`[workflows] the queued retry of ${runId} could not be replayed`, cause));
      const after = this.ports.ledger.get(runId), key = after && this.workspaceKey(after);
      if (after?.workspaceWait && (!key || this.ports.leases.holder(key) !== after.workspaceWait.heldByRunId)) await this.ports.ledger.waitForWorkspace(runId, null);
    } finally { this.replaying.delete(runId); }
  }

  private async writerMayRun(runId: string, stepId: string) {
    const run = this.ports.ledger.get(runId), step = run?.steps.find(item => item.stepId === stepId);
    if (!run || !step) return false;
    if (this.starting.has(runId) || step.state === "running" || run.state === "cancelling") return true;
    const last = step.attempts.at(-1);
    return last?.outcome === "unknown" && last.requestId !== null && (await this.ports.agent.processOf(last.requestId)).state === "held";
  }

  private settleFromCustody(run: WorkflowRun, proof: StopProof) { return settleFromCustody(this.ports, run, proof); }
  private settleUnconfirmed(runId: string, groups: WorkflowRun["forceStopGroups"], detail: "force-stopped" | "force-stopped-confirmed-at-startup") {
    return settleUnconfirmed(this.ports, runId, groups, detail);
  }

  /** Q2: a suspended binding pauses each of its unfinished runs after the current step, with the reason. */
  async suspendBinding(bindingId: string, reason: string) { await this.pauseRuns(run => run.bindingId === bindingId, { kind: "binding-suspended", detail: reason }); }
  /** Q29: a turned-off Provider pauses each unfinished run with an agent step of that Provider still ahead. */
  /** A-04: the Workflow plugin turned off pauses every unfinished run after its current step. */
  async pauseForWorkflowPlugin() { await this.pauseRuns(() => true, { kind: "plugin-disabled", detail: "workflow" }); }
  async pauseForProvider(providerId: string) {
    await this.pauseRuns(run => run.recipe.steps.some(step => step.kind === "agent.run"
      && ["pending", "running", "blocked"].includes(run.steps.find(item => item.stepId === step.id)?.state ?? "")
      && (run.configs[step.role] as { resolved?: { provider?: string } } | undefined)?.resolved?.provider === providerId), { kind: "plugin-disabled", detail: providerId });
  }
  private async pauseRuns(match: (run: WorkflowRun) => boolean, reason: PauseReason) {
    for (const run of this.ports.ledger.list()) {
      if (["succeeded", "failed", "cancelled", "paused"].includes(run.state) || !match(run)) continue;
      await this.ports.ledger.pause(run.runId, reason).catch(() => undefined);
    }
  }
}
