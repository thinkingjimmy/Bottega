/**
 * [INPUT]: Depends on shared availability contracts and an injected clock.
 * [OUTPUT]: Owns environment-scoped startup/authentication evidence, check timestamps, cancellation and existing purpose authorization lifetimes; the allow conclusion follows the shared positiveAuth scope rule, so an unscoped confirmation authorizes a scoped operation target.
 * [POS]: Registry-owned evidence memory; probes own global auth, turns own scoped operation evidence.
 */
import type { AgentBackendId, BackendAuthStatus, BackendCapabilities, HeadlessPurpose, UsageLimitInfo } from "../../../../shared/agent-ipc";
import { activeNegative, matchesTarget, positiveAuth } from "../../../../shared/agent-availability/projection";
import { AUTH_TTL_MS, TURN_EVIDENCE_TTL_MS, type AvailabilityDecision, type AvailabilityFacts, type ExecutionTarget, type TurnAvailabilityEvidence } from "../../../../shared/agent-availability/types";

export type TurnEvidenceStart = Readonly<{
  conversationId: string;
  requestId: string;
  target: ExecutionTarget;
  startedAt: number;
  revision: number;
  negativeId?: string;
  negativeRevision?: number;
}>;
type State = { facts: AvailabilityFacts; turns: Map<string, TurnAvailabilityEvidence>; successes: Map<string, TurnAvailabilityEvidence>; authFailures: Map<string, number> };
export class AvailabilityEvidence {
  private sequence = 0;
  private readonly states = new Map<AgentBackendId, State>();
  private readonly retries = new Map<string, TurnEvidenceStart>();
  constructor(readonly now: () => number = Date.now) {}

  private state(backend: AgentBackendId): State {
    let value = this.states.get(backend);
    if (!value) {
      value = { facts: { revision: 0, environmentGeneration: 0, probeGeneration: 0, capabilityKnowledge: "unknown" }, turns: new Map(), successes: new Map(), authFailures: new Map() };
      this.states.set(backend, value);
    }
    return value;
  }
  facts(backend: AgentBackendId) { return this.state(backend).facts; }
  update(backend: AgentBackendId, patch: Partial<AvailabilityFacts>) {
    const state = this.state(backend);
    state.facts = { ...state.facts, ...patch, revision: ++this.sequence };
    return state.facts;
  }
  invalidate(backend: AgentBackendId, environmentGeneration: number) {
    this.state(backend).turns.clear();
    this.state(backend).successes.clear();
    this.state(backend).authFailures.clear();
    return this.update(backend, { environmentGeneration, lastConfirmedAuth: undefined, authCheck: undefined,
      runtimeCheck: undefined, runtimeIssue: undefined, checkIssue: undefined, startup: undefined, lastCheckedAt: undefined, authUnknownReason: undefined, capabilityKnowledge: "unknown" });
  }
  beginProbe(backend: AgentBackendId) {
    const generation = this.facts(backend).probeGeneration + 1;
    this.update(backend, { probeGeneration: generation, authCheck: { phase: "queued", startedAt: this.now() } });
    return generation;
  }
  confirm(backend: AgentBackendId, probeGeneration: number, environmentGeneration: number, status: BackendAuthStatus, scopeKey?: string,
    result?: { checkIssue?: import("../../../../shared/agent-availability/types").CheckIssue; startup?: "ready" | "cannot-start"; unknownReason?: "provider-scoped" | "not-supported" }) {
    const facts = this.facts(backend);
    if (facts.probeGeneration !== probeGeneration || facts.environmentGeneration !== environmentGeneration) return false;
    const checkedAt = this.now();
    this.update(backend, {
      lastCheckedAt: checkedAt,
      checkIssue: result?.checkIssue,
      authUnknownReason: result?.unknownReason,
      ...(result?.startup ? { startup: { status: result.startup, environmentGeneration, checkedAt } } : {}),
      authCheck: { phase: status === "error" ? "error" : "complete", startedAt: facts.authCheck?.startedAt ?? checkedAt, checkedAt },
      ...((status === "authenticated" || status === "unauthenticated") ? {
        lastConfirmedAuth: { id: `${backend}:${++this.sequence}`, revision: this.sequence, environmentGeneration, status, checkedAt, scopeKey,
          ...(status === "authenticated" ? { expiresAt: checkedAt + AUTH_TTL_MS } : {}) },
      } : {}),
    });
    return true;
  }
  cancel(backend: AgentBackendId, probeGeneration: number, environmentGeneration: number) {
    const facts = this.facts(backend);
    if (facts.probeGeneration !== probeGeneration || facts.environmentGeneration !== environmentGeneration) return false;
    this.update(backend, { authCheck: { phase: "cancelled", startedAt: facts.authCheck?.startedAt ?? this.now(), checkedAt: this.now() } });
    return true;
  }
  bindRetry(conversationId: string, requestId: string, target: ExecutionTarget) {
    const existing = this.retries.get(requestId);
    if (existing) {
      if (existing.conversationId !== conversationId || !matchesTarget(existing.target, target)) throw new Error("Authentication retry belongs to another operation");
      return existing;
    }
    const negative = activeNegative(this.facts(target.backend).lastConfirmedAuth, target.environmentGeneration, target.scopeKey);
    const receipt = Object.freeze({ conversationId, requestId, target: Object.freeze({ ...target }), startedAt: this.now(), revision: ++this.sequence,
      ...(negative ? { negativeId: negative.id, negativeRevision: negative.revision } : {}) });
    this.retries.set(requestId, receipt);
    if (this.retries.size > 512) this.retries.delete(this.retries.keys().next().value!);
    return receipt;
  }
  permitsRetry(conversationId: string, requestId: string, target: ExecutionTarget) {
    const receipt = this.retries.get(requestId);
    const negative = activeNegative(this.facts(target.backend).lastConfirmedAuth, target.environmentGeneration, target.scopeKey);
    return Boolean(receipt && receipt.conversationId === conversationId && matchesTarget(receipt.target, target) &&
      (!negative || (receipt.negativeId === negative.id && receipt.negativeRevision === negative.revision)));
  }
  beginTurn(conversationId: string, requestId: string, target: ExecutionTarget): TurnEvidenceStart {
    const retry = this.retries.get(requestId);
    return Object.freeze({ conversationId, requestId, target: Object.freeze({ ...target }), startedAt: this.now(), revision: ++this.sequence,
      ...(retry && retry.conversationId === conversationId && matchesTarget(retry.target, target) ? { negativeId: retry.negativeId, negativeRevision: retry.negativeRevision } : {}) });
  }
  finish(start: TurnEvidenceStart, outcome: TurnAvailabilityEvidence["outcome"], limit?: UsageLimitInfo) {
    this.retries.delete(start.requestId);
    const state = this.state(start.target.backend);
    if (start.target.environmentGeneration !== state.facts.environmentGeneration) return undefined;
    const previous = state.turns.get(start.conversationId);
    if (previous && (previous.startedRevision ?? previous.revision) > start.revision) return undefined;
    const checkedAt = this.now();
    const evidence: TurnAvailabilityEvidence = { ...start, startedRevision: start.revision, outcome, checkedAt, expiresAt: checkedAt + TURN_EVIDENCE_TTL_MS, revision: ++this.sequence, ...(limit ? { limit } : {}) };
    const negative = state.facts.lastConfirmedAuth;
    if (outcome === "success" && start.target.scopeKey && negative?.scopeKey === start.target.scopeKey &&
      negative.id === start.negativeId && negative.revision === start.negativeRevision && negative.status === "unauthenticated" &&
      start.startedAt >= negative.checkedAt && start.revision > negative.revision) {
      this.update(start.target.backend, { lastConfirmedAuth: { ...negative, supersededBy: start.requestId } });
    } else this.update(start.target.backend, {});
    if (outcome === "success" && start.target.scopeKey) {
      state.successes.set(start.requestId, evidence);
      if (state.successes.size > 512) state.successes.delete(state.successes.keys().next().value!);
    }
    if (outcome === "auth-required" && start.target.scopeKey) {
      state.authFailures.set(start.target.scopeKey, Math.max(start.revision, state.authFailures.get(start.target.scopeKey) ?? 0));
    }
    state.turns.set(start.conversationId, evidence);
    if (state.turns.size > 512) state.turns.delete(state.turns.keys().next().value!);
    return evidence;
  }
  retryTarget(conversationId: string, requestId: string) {
    const receipt = this.retries.get(requestId);
    return receipt?.conversationId === conversationId ? receipt.target : undefined;
  }
  discardRetry(requestId: string) { this.retries.delete(requestId); }
  recent(backend: AgentBackendId, conversationId: string) { return this.state(backend).turns.get(conversationId); }
  eligibility(target: ExecutionTarget, capabilities: BackendCapabilities, purpose: HeadlessPurpose | "app-binding", runtimeInstalled: boolean): AvailabilityDecision & { expiresAt?: number } {
    if (!runtimeInstalled) return { decision: "block", reason: "cannot-check" };
    if (purpose !== "app-binding" && (!capabilities.headless.includes(purpose) ||
      (["repair", "serve", "install-analysis"].includes(purpose) && !capabilities.maintenance))) return { decision: "block", reason: "unsupported" };
    const state = this.state(target.backend);
    if (state.facts.startup?.status === "cannot-start" && state.facts.startup.environmentGeneration === target.environmentGeneration) {
      return { decision: "block", reason: "cannot-start" };
    }
    if (state.facts.runtimeCheck?.phase === "error" && (state.facts.runtimeCheck.expiresAt ?? 0) <= this.now()) {
      return { decision: "block", reason: "cannot-check" };
    }
    if (activeNegative(state.facts.lastConfirmedAuth, target.environmentGeneration, target.scopeKey)) return { decision: "block", reason: "auth-required" };
    /* positiveAuth already encodes the product rule the renderer uses: an unscoped
       confirmation is valid for every scope, a scoped one only for its own. The extra
       equality that used to guard this branch made the probe's confirmation — taken on
       the default target, which is unscoped for anyone owning a CLI config file — unable
       to authorize the title target, which always carries a fingerprint. */
    if (positiveAuth(state.facts.lastConfirmedAuth, target.environmentGeneration, this.now(), target.scopeKey)) {
      return { decision: "allow", expiresAt: state.facts.lastConfirmedAuth?.expiresAt };
    }
    if (target.scopeKey) {
      for (const evidence of state.successes.values()) {
        if (evidence.outcome === "success" && evidence.target.scopeKey === target.scopeKey &&
          evidence.target.environmentGeneration === target.environmentGeneration && evidence.expiresAt > this.now() &&
          (evidence.startedRevision ?? evidence.revision) > (state.authFailures.get(target.scopeKey) ?? 0)) {
          return { decision: "allow", expiresAt: evidence.expiresAt };
        }
      }
    }
    return { decision: "wait", reason: "auth-unknown" };
  }
}
