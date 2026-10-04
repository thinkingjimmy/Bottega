/**
 * [INPUT]: Depends on descriptors (including their credential-safe check claim), supervised runtime probes (versions through runtime-version-cache.ts), filesystem identity, bounded leases, the host Provider traits (which sign-in checks queue for a lease, which answers are workspace-scoped), each descriptor's route (under a custom one an official "logged out" is no evidence) and the registry-owned availability ledger.
 * [OUTPUT]: Owns 60-second runtime and five-minute full checks, cancellation-preserved evidence, independent startup facts, scoped purpose eligibility and a read-only per-CLI account fingerprint, for any Provider id its resolver runs (a built-in or an available package Provider; an id it does not is refused by name and stores nothing): discovery bounded by the flight's own deadline, the version run on the backend's declared arguments, the list over the resolver's ids and forget for a package Provider that stopped being available.
 * [POS]: The only owner of the backends running time and discovery/auth subprocess; Chat, Section, Settings and Background tasks cannot detect CLI on their own
 * Warm installed/unsupported snapshots revalidate executable identity; discovered versions carry versionIdentity.
 */

import { inspectRuntimeCandidate, optionalRuntimeIdentity } from "./runtime-inspection";
import type { BackendInfo } from "../../../../shared/ipc/agent/agent-ipc";
import type { ProviderId } from "@ai-chat/cloud-protocol/contracts/provider";
import { createHash } from "node:crypto";
import { AGENT_BACKEND_ORDER, type HeadlessPurpose } from "../../../../shared/ipc/agent/agent-ipc";
import { AUTH_TTL_MS, RUNTIME_TTL_MS, type RuntimeIssue, type ExecutionTarget } from "../../../../shared/agent-availability/types";
import { CHECK_QUEUE_MS, MAX_RUNTIME_CANDIDATES, RUNTIME_DISCOVERY_MS, FULL_CHECK_MS } from "./availability/budgets";
import { expireLoginShellPath } from "./runtime-probe";
import { AvailabilityEvidence, type TurnEvidenceStart } from "./availability/evidence";
import { executionScope, runtimeEnvironmentIdentity, type ScopePlan } from "./availability/scope";
import { DISABLED_CAPABILITIES, summarizeCandidateDiagnostics, executableIdentity, sameIdentity, waitForSignal,
  type BackendRuntimeSnapshot, type RegistryDependencies, type StoredSnapshot, type InspectedCandidate,
  type PresentSnapshot, type MissingSnapshot } from "./availability/runtime";
export { DISABLED_CAPABILITIES } from "./availability/runtime";
export type { BackendRuntimeSnapshot } from "./availability/runtime";
import { providerTraits } from "../../../../shared/providers/traits";
import type {
  AgentRuntime,
  RuntimeConfirmation,
} from "../types";
import {
  acquireAgentProcessLease,
  reserveAgentCredentialUse,
  type AgentProcessLease,
} from "../../agent-process-supervisor";

export class BackendRuntimeRegistry {
  private readonly generations = new Map<ProviderId, number>();
  private readonly snapshots = new Map<ProviderId, StoredSnapshot>();
  private readonly lastKnownCapabilities = new Map<ProviderId, BackendInfo["capabilities"]>();
  private readonly flights = new Map<
    ProviderId,
    {
      generation: number;
      controller: AbortController;
      promise: Promise<BackendRuntimeSnapshot>;
    }
  >();
  private readonly listeners = new Set<
    (backend: ProviderId, snapshot: BackendRuntimeSnapshot) => void
  >();
  private shuttingDown = false;
  readonly evidence: AvailabilityEvidence;
  private readonly environmentIdentities = new Map<ProviderId, string>();
  private readonly purposeTargets = new Map<ProviderId, { regular: ExecutionTarget; isolated: ExecutionTarget }>();
  private readonly authFlights = new Map<ProviderId, { controller: AbortController; promise: Promise<BackendRuntimeSnapshot>; environmentGeneration?: number }>();
  private readonly turnListeners = new Set<(event: import("../../../../shared/agent-availability/types").TurnAvailabilityEvidence) => void>();

  constructor(private readonly dependencies: RegistryDependencies) { this.evidence = new AvailabilityEvidence(dependencies.now); }

  current(backend: ProviderId) {
    return this.snapshots.get(backend)?.snapshot;
  }

  /* Opaque hash of the account each CLI is signed in to (TASK-28); signed out → null, a failed check keeps the last value.
     Read-only: a change arrives through `subscribe` like any other snapshot change. */
  private readonly accountFingerprints = new Map<ProviderId, string | null>();
  accountFingerprint(backend: ProviderId) { return this.accountFingerprints.get(backend) ?? null; }

  subscribe(
    listener: (backend: ProviderId, snapshot: BackendRuntimeSnapshot) => void
  ) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  invalidate(backend: ProviderId) {
    const generation = this.generation(backend) + 1;
    this.generations.set(backend, generation);
    this.evidence.invalidate(backend, generation);
    this.authFlights.get(backend)?.controller.abort(new Error("Execution environment changed"));
    this.authFlights.delete(backend);
    this.environmentIdentities.delete(backend);
    this.purposeTargets.delete(backend);
    this.snapshots.delete(backend);
    this.flights
      .get(backend)
      ?.controller.abort(new Error(`${backend} runtime generation 已失效`));
    this.flights.delete(backend);
    for (const listener of this.listeners) listener(backend, this.snapshot(backend));
    return generation;
  }

  snapshot(backend: ProviderId): BackendRuntimeSnapshot {
    return this.current(backend) ?? {
      runtimeStatus: "unknown", authStatus: "unknown", capabilities: this.lastKnownCapabilities.get(backend) ?? DISABLED_CAPABILITIES,
      generation: this.generation(backend), availability: this.evidence.facts(backend),
    };
  }

  /* A read never starts discovery (OPT-20): a launch discovers only the default Agent, and every surface that shows
     all Agents asks through refreshIfNeeded / recheck. `kimi --version` alone is ~430 MB. */
  listSnapshots(): BackendInfo[] {
    return (this.dependencies.providerIds?.() ?? AGENT_BACKEND_ORDER).map((backend) => this.toBackendInfo(backend, this.snapshot(backend)));
  }

  /* A package Provider that stopped being available, or whose package changed, keeps nothing: no snapshot, evidence, capabilities or
     account; listeners hear `unknown` once. The next resolve is refused by name until a backend runs the id again. */
  forget(backend: ProviderId) {
    this.invalidate(backend);
    this.lastKnownCapabilities.delete(backend);
    this.accountFingerprints.delete(backend);
  }

  recheck(backend: ProviderId) { return this.fullCheck(backend, "user-recheck"); }

  async refreshIfNeeded(backend: ProviderId) {
    const facts = this.evidence.facts(backend);
    if (facts.lastCheckedAt === undefined || facts.lastCheckedAt + AUTH_TTL_MS <= this.evidence.now()) {
      return this.fullCheck(backend, "automatic");
    }
    const snapshot = await this.resolve(backend);
    if (this.evidence.facts(backend).environmentGeneration !== facts.environmentGeneration) {
      return this.fullCheck(backend, "automatic");
    }
    return snapshot;
  }

  fullCheck(backend: ProviderId, intent: "startup" | "user-recheck" | "login-return" | "automatic") {
    void intent;
    if (this.shuttingDown) return Promise.reject(new Error("Runtime registry is shutting down"));
    try { this.dependencies.descriptorFor(backend); } catch (cause) { return Promise.reject(cause); }
    const existing = this.authFlights.get(backend);
    if (existing) return existing.promise;
    let credentialUse: ReturnType<typeof reserveAgentCredentialUse> | undefined;
    let ready: Promise<void>;
    /* A credential-safe check cannot read or rewrite the account, so reserving credentials
       would only make the quota read wait for something it never contends with. */
    if (this.dependencies.descriptorFor(backend).auth?.credentialSafe) ready = Promise.resolve();
    else try { credentialUse = reserveAgentCredentialUse(backend); ready = credentialUse.ready; }
    catch (cause) { ready = Promise.reject(cause); }
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(new Error("Availability check deadline exceeded")), FULL_CHECK_MS);
    const previous = this.snapshot(backend);
    const probe = this.evidence.beginProbe(backend);
    // Publish the discovery flight synchronously; warm reads must join it rather than invalidate this check.
    const discovery = this.resolve(backend, true);
    void discovery.catch(() => undefined);
    const promise = this.checkAuthentication(backend, probe, controller.signal, discovery, ready, previous).finally(() => {
      credentialUse?.release();
      clearTimeout(deadline);
      if (this.authFlights.get(backend)?.promise === promise) this.authFlights.delete(backend);
    });
    this.authFlights.set(backend, { controller, promise });
    return promise;
  }

  waitForCheck(backend: ProviderId) { return this.authFlights.get(backend)?.promise; }

  cancelCheck(backend: ProviderId) {
    this.authFlights.get(backend)?.controller.abort(new DOMException("Availability check cancelled", "AbortError"));
  }

  private async checkAuthentication(backend: ProviderId, probe: number, signal: AbortSignal, discovery: Promise<BackendRuntimeSnapshot>, ready: Promise<void>, previous: BackendRuntimeSnapshot) {
    let expectedEnvironment = this.generation(backend);
    try {
      await waitForSignal(ready, signal);
      // A fresh runtime flight never owns or waits for authentication resources.
      const snapshot = await waitForSignal(discovery, signal);
      if (snapshot.runtimeStatus !== "installed") {
        this.evidence.confirm(backend, probe, snapshot.generation, "error");
        const stored = this.snapshots.get(backend);
        if (stored) this.publish(backend, snapshot.generation, stored);
        return this.snapshot(backend);
      }
      expectedEnvironment = snapshot.generation;
      const flight = this.authFlights.get(backend);
      if (flight?.controller.signal === signal) flight.environmentGeneration = expectedEnvironment;
      const descriptor = this.dependencies.descriptorFor(backend);
      const startedAt = this.evidence.now();
      this.evidence.update(backend, { authCheck: { phase: "queued", startedAt } });
      this.publish(backend, snapshot.generation, { ...this.snapshots.get(backend)!, snapshot: { ...snapshot, authStatus: "checking" } });
      let lease: AgentProcessLease | undefined;
      try {
        // ACP readiness owns its background lease; CLI auth has no nested lease.
        if (providerTraits(backend).authCheckLease) {
          const queueSignal = AbortSignal.any([signal, AbortSignal.timeout(CHECK_QUEUE_MS)]);
          lease = await (this.dependencies.acquireLease ?? acquireAgentProcessLease)(backend, "background", queueSignal);
        }
        const authenticationStarted = () => {
          if (this.generation(backend) !== expectedEnvironment || this.evidence.facts(backend).probeGeneration !== probe) return;
          this.evidence.update(backend, { authCheck: { phase: "authentication", startedAt } });
          const current = this.snapshots.get(backend);
          if (current) this.publish(backend, expectedEnvironment, current);
        };
        if (lease) authenticationStarted();
        const result = descriptor.auth ? await waitForSignal(descriptor.auth.check(snapshot.runtime, signal, authenticationStarted), signal) : { status: "unknown" as const, unknownReason: "not-supported" as const };
        const target = await this.executionTarget(backend, snapshot);
        const scoped = providerTraits(backend).authScope === "workspace" && !target.scopeKey && result.status !== "error"
          ? { ...result, status: "unknown" as const, unknownReason: "provider-scoped" as const } : result;
        /* Under a custom route an official "logged out" is no evidence against the endpoint (TASK-13 E); a route that cannot be
           read is not claimed official. A positive answer keeps admitting what it admitted; only the display changes. */
        const route = descriptor.auth?.route ? await descriptor.auth.route(snapshot.runtime).catch(() => "custom" as const) : "official";
        const auth = route === "custom" && scoped.status === "unauthenticated"
          ? { ...scoped, status: "unknown" as const, unknownReason: "custom-route" as const, reason: undefined } : scoped;
        if (!this.evidence.confirm(backend, probe, snapshot.generation, auth.status, target.scopeKey,
          { ...auth, ...(route === "custom" ? { route } : {}) })) return this.snapshot(backend);
        const latest = this.snapshots.get(backend)!;
        if (latest.snapshot.runtimeStatus !== "installed") return latest.snapshot;
        if (auth.status === "authenticated") this.accountFingerprints.set(backend, auth.accountFingerprint ?? null);
        else if (auth.status === "unauthenticated") this.accountFingerprints.set(backend, null);
        this.publish(backend, snapshot.generation, { ...latest, snapshot: { ...latest.snapshot, authStatus: auth.status, reason: auth.reason ?? (this.evidence.facts(backend).runtimeCheck?.phase === "error" ? latest.snapshot.reason : undefined) } });
      } finally { lease?.release(); }
    } catch (cause) {
      const flight = this.authFlights.get(backend);
      if (flight?.controller.signal === signal && flight.environmentGeneration === undefined) {
        expectedEnvironment = this.generation(backend);
      }
      const cancelled = signal.aborted && signal.reason?.name === "AbortError";
      if (cancelled ? this.evidence.cancel(backend, probe, expectedEnvironment) : this.evidence.confirm(backend, probe, expectedEnvironment, "error", undefined, {
        checkIssue: signal.aborted ? "timeout" : (cause as Error)?.name === "TimeoutError" ? "busy" : "failed",
      })) {
        const latest = this.snapshots.get(backend) ?? { snapshot: this.snapshot(backend) };
        const snapshot = latest.snapshot;
        const prior = previous.generation === snapshot.generation ? previous : undefined;
        const reason = cancelled ? prior?.reason : cause instanceof Error ? cause.message : String(cause);
        const next: BackendRuntimeSnapshot = snapshot.runtimeStatus === "installed" || snapshot.runtimeStatus === "unsupported"
          ? { ...snapshot, authStatus: cancelled ? prior?.authStatus === "checking" ? "unknown" : prior?.authStatus ?? "unknown" : "error", reason }
          : { ...snapshot, authStatus: cancelled ? "unknown" : "error", reason };
        this.publish(backend, snapshot.generation, { ...latest, snapshot: next });
      }
    }
    return this.snapshot(backend);
  }

  /* Closed means every resolve rejects. A handler that answers a renderer asks this instead of catching
     the rejection: after a safe quit the renderer keeps refreshing for a while, and each of those
     refreshes used to print a full stack under "Runtime Registry 正在退出" (N-3 / AC-8). */
  get closed() { return this.shuttingDown; }

  resolve(backend: ProviderId, refresh = false): Promise<BackendRuntimeSnapshot> {
    if (this.shuttingDown) {
      return Promise.reject(new Error("Runtime Registry 正在退出"));
    }
    /* An id nothing runs is refused by name before any flight or stored snapshot exists for it. */
    try { this.dependencies.descriptorFor(backend); } catch (cause) { return Promise.reject(cause); }
    /* A forced refresh is the user (or a login return) saying the environment changed;
       the shared login-shell PATH must be re-read, not served from the 60 s cache. */
    if (refresh) expireLoginShellPath();
    const generation = this.generation(backend);
    const existing = this.flights.get(backend);
    if (existing?.generation === generation) return existing.promise;
    const stored = this.snapshots.get(backend)?.snapshot;
    if (
      stored?.generation === generation && !refresh &&
      (stored.availability?.runtimeCheck?.expiresAt ?? 0) > this.evidence.now()
    ) {
      return this.confirmStored(backend, stored);
    }
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(new Error("Runtime discovery deadline exceeded")), RUNTIME_DISCOVERY_MS);
    this.evidence.update(backend, { runtimeCheck: { ...this.evidence.facts(backend).runtimeCheck, phase: "queued", startedAt: this.evidence.now() } });
    const promise: Promise<BackendRuntimeSnapshot> = this.discover(
      backend,
      generation,
      controller.signal
    )
      .catch((cause) => {
        const flight = this.flights.get(backend);
        const expectedGeneration = flight && flight.promise === promise ? flight.generation : generation;
        if (this.generation(backend) !== expectedGeneration && !this.shuttingDown) return this.resolve(backend);
        return this.finishMissing(backend, expectedGeneration, "error", cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        clearTimeout(deadline);
        if (this.flights.get(backend)?.promise === promise) {
          this.flights.delete(backend);
        }
      });
    this.flights.set(backend, { generation, controller, promise });
    return promise;
  }

  /* 缓存命中不等于仍可启动：descriptor 可以在快照被复用前重读外部真相。
     被拒就作废并重新发现——新路径经完整校验入册，这里不替发现层裁决。
     confirm 抛错同样按拒绝处理，fail-closed。 */
  private async confirmStored(backend: ProviderId, stored: BackendRuntimeSnapshot): Promise<BackendRuntimeSnapshot> {
    const descriptor = this.dependencies.descriptorFor(backend);
    if (stored.runtimeStatus !== "installed" && stored.runtimeStatus !== "unsupported") return stored;
    const expected = this.snapshots.get(backend)?.identity;
    const actual = await this.optionalIdentity(stored.runtime.executable);
    if (this.generation(backend) !== stored.generation) return this.resolve(backend);
    if (!expected || !actual || !sameIdentity(expected, actual)) {
      this.invalidate(backend);
      return this.resolve(backend);
    }
    if (stored.runtimeStatus === "unsupported") return stored;
    const environmentIdentity = await runtimeEnvironmentIdentity(backend, stored.runtime);
    if (this.environmentIdentities.get(backend) !== environmentIdentity) {
      this.invalidate(backend);
      return this.resolve(backend);
    }
    if (!descriptor.confirmRuntime) return stored;
    let confirmation: RuntimeConfirmation;
    try {
      confirmation = await descriptor.confirmRuntime(stored.runtime);
    } catch (cause) {
      confirmation = {
        status: "rejected",
        reason: cause instanceof Error ? cause.message : String(cause),
      };
    }
    if (confirmation.status === "confirmed") return stored;
    if (this.generation(backend) === stored.generation) this.invalidate(backend);
    return this.resolve(backend);
  }

  async resolveForSpawn(
    backend: ProviderId,
    signal?: AbortSignal
  ) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      signal?.throwIfAborted();
      const snapshot = await waitForSignal(this.resolve(backend), signal);
      if (snapshot.runtimeStatus !== "installed") return snapshot;
      const stored = this.snapshots.get(backend);
      if (!stored?.identity) {
        this.invalidate(backend);
        continue;
      }
      const identity = await this.optionalIdentity(
        snapshot.runtime.executable,
        signal
      );
      const current = this.snapshots.get(backend);
      if (
        this.generation(backend) !== snapshot.generation ||
        current?.snapshot.generation !== snapshot.generation
      ) {
        continue;
      }
      if (
        identity &&
        current.snapshot.runtimeStatus === "installed" &&
        current.snapshot.runtime.executable === snapshot.runtime.executable &&
        current.snapshot.runtime.version === snapshot.runtime.version &&
        current.identity &&
        sameIdentity(identity, current.identity)
      ) {
        return current.snapshot;
      }
      this.invalidate(backend);
    }
    return this.finishMissing(
      backend,
      this.generation(backend),
      "error",
      "CLI identity kept changing before spawn",
      "identity-changed"
    );
  }

  async confirmForSpawn(
    backend: ProviderId,
    expected: BackendRuntimeSnapshot,
    signal?: AbortSignal
  ) {
    signal?.throwIfAborted();
    if (expected.runtimeStatus !== "installed") return false;
    const stored = this.snapshots.get(backend);
    if (
      this.generation(backend) !== expected.generation ||
      stored?.snapshot.generation !== expected.generation ||
      stored.snapshot.runtimeStatus !== "installed" ||
      stored.snapshot.runtime.executable !== expected.runtime.executable ||
      stored.snapshot.runtime.version !== expected.runtime.version ||
      !stored.identity
    ) {
      return false;
    }
    const identity = await this.optionalIdentity(
      expected.runtime.executable,
      signal
    );
    const current = this.snapshots.get(backend);
    if (
      this.generation(backend) !== expected.generation ||
      current?.snapshot.generation !== expected.generation ||
      current.snapshot.runtimeStatus !== "installed" ||
      current.snapshot.runtime.executable !== expected.runtime.executable ||
      current.snapshot.runtime.version !== expected.runtime.version ||
      !current.identity ||
      !identity ||
      !sameIdentity(identity, current.identity)
    ) {
      if (this.generation(backend) === expected.generation) {
        this.invalidate(backend);
      }
      return false;
    }
    const environmentIdentity = await runtimeEnvironmentIdentity(backend, expected.runtime);
    if (environmentIdentity !== this.environmentIdentities.get(backend)) {
      if (this.generation(backend) === expected.generation) this.invalidate(backend);
      return false;
    }
    return this.generation(backend) === expected.generation;
  }

  async shutdown() {
    this.shuttingDown = true;
    const flights = [...this.flights.values(), ...this.authFlights.values()];
    for (const flight of flights) {
      flight.controller.abort(new Error("Runtime Registry 正在退出"));
    }
    await Promise.allSettled(flights.map((flight) => flight.promise));
  }

  reopen() {
    if (this.flights.size > 0 || this.authFlights.size > 0) return false;
    this.shuttingDown = false;
    return true;
  }

  async executionTarget(backend: ProviderId, snapshot: BackendRuntimeSnapshot, plan: ScopePlan = {}): Promise<ExecutionTarget> {
    const stored = this.snapshots.get(backend);
    const identity = stored?.snapshot.generation === snapshot.generation ? stored.identity : undefined;
    const identityKey = identity ? createHash("sha256").update(JSON.stringify(identity, (_, value) => typeof value === "bigint" ? String(value) : value)).digest("hex") : undefined;
    const scopeKey = snapshot.runtimeStatus === "installed" && identityKey ? await executionScope(backend, snapshot.runtime, identityKey, plan) : undefined;
    return { backend, environmentGeneration: snapshot.generation, scopeKey, ...(plan.model ? { model: plan.model } : {}) };
  }

  async operationEligibility(backend: ProviderId, purpose: HeadlessPurpose | "app-binding", plan: ScopePlan = {}, snapshot = this.snapshot(backend)) {
    const target = await this.executionTarget(backend, snapshot, plan);
    return this.evidence.eligibility(target, snapshot.capabilities, purpose, snapshot.runtimeStatus === "installed");
  }

  subscribeTurnEvidence(listener: (event: import("../../../../shared/agent-availability/types").TurnAvailabilityEvidence) => void) {
    this.turnListeners.add(listener);
    return () => this.turnListeners.delete(listener);
  }

  markTurnSuccess(backend: ProviderId, generation: number, start?: TurnEvidenceStart) {
    if (!start || start.target.backend !== backend || start.target.environmentGeneration !== generation) return false;
    return this.recordTurn(start, "success");
  }

  markAuthFailure(backend: ProviderId, generation: number, start?: TurnEvidenceStart) {
    if (!start || start.target.backend !== backend || start.target.environmentGeneration !== generation) return false;
    return this.recordTurn(start, "auth-required");
  }

  recordTurn(start: TurnEvidenceStart, outcome: import("../../../../shared/agent-availability/types").TurnAvailabilityEvidence["outcome"], limit?: import("../../../../shared/ipc/agent/agent-ipc").UsageLimitInfo) {
    const event = this.evidence.finish(start, outcome, limit);
    if (!event) return false;
    const stored = this.snapshots.get(start.target.backend);
    if (stored) this.publish(start.target.backend, start.target.environmentGeneration, stored);
    for (const listener of this.turnListeners) listener(event);
    return true;
  }

  /* Generic so a built-in caller keeps its AgentBackendId without a cast. */
  toBackendInfo<Id extends ProviderId>(
    backend: Id,
    snapshot: BackendRuntimeSnapshot
  ): BackendInfo & { id: Id } {
    const descriptor = this.dependencies.descriptorFor(backend);
    return {
      id: backend,
      displayName: descriptor.displayName,
      minimumVersion: descriptor.minimumVersion,
      runtimeStatus: snapshot.runtimeStatus,
      authStatus: snapshot.authStatus,
      capabilities: snapshot.capabilities,
      availability: {
        ...(snapshot.availability ?? this.evidence.facts(backend)),
        purposeEligibility: Object.fromEntries((["title", "subagent", "install-analysis", "repair", "serve", "app-binding"] as const).map((purpose) => {
          const target = this.purposeTargets.get(backend)?.[purpose === "subagent" || purpose === "app-binding" ? "regular" : "isolated"] ?? { backend, environmentGeneration: snapshot.generation };
          return [purpose, this.evidence.eligibility(target, snapshot.capabilities, purpose, snapshot.runtimeStatus === "installed")];
        })),
      },
      ...(snapshot.runtimeStatus === "installed" ||
      snapshot.runtimeStatus === "unsupported"
        ? {
            version: snapshot.runtime.version,
            path: snapshot.runtime.executable,
          }
        : {}),
      /* 诊断只有一份，就是探针原文。「该装还是该登」是 runtimeStatus
         的函数，呈现层手里本就有这一位；main 若替它拼一句话，产品文案
         就被烤成一门语言，i18n 的接缝随之永久消失。 */
      ...(snapshot.reason ? { reason: snapshot.reason } : {}),
    };
  }

  private generation(backend: ProviderId) {
    return this.generations.get(backend) ?? 0;
  }

  private publish(
    backend: ProviderId,
    generation: number,
    value: StoredSnapshot
  ) {
    if (this.generation(backend) !== generation) return false;
    value = { ...value, snapshot: { ...value.snapshot, availability: this.evidence.update(backend, {}) } };
    // Unknown discovery is not evidence that the running process lost its capabilities.
    if (value.snapshot.availability?.capabilityKnowledge === "known") {
      this.lastKnownCapabilities.set(backend, value.snapshot.capabilities);
    }
    this.snapshots.set(backend, value);
    for (const listener of this.listeners) listener(backend, value.snapshot);
    return true;
  }

  private async discover(
    backend: ProviderId,
    generation: number,
    signal: AbortSignal
  ) {
    let lease: AgentProcessLease;
    try {
      lease = await (
        this.dependencies.acquireLease ?? acquireAgentProcessLease
      )(backend, "background", AbortSignal.any([signal, AbortSignal.timeout(CHECK_QUEUE_MS)]));
    } catch (cause) {
      signal.throwIfAborted();
      return this.finishMissing(
        backend,
        generation,
        "error",
        cause instanceof Error ? cause.message : String(cause),
        "queue-timeout"
      );
    }
    try {
      this.evidence.update(backend, { runtimeCheck: { ...this.evidence.facts(backend).runtimeCheck, phase: "discovery", startedAt: this.evidence.now() } });
      return await this.discoverLeased(backend, generation, signal);
    } finally {
      lease.release();
    }
  }

  private async discoverLeased(
    backend: ProviderId,
    generation: number,
    signal: AbortSignal
  ) {
    const descriptor = this.dependencies.descriptorFor(backend);
    let candidates: readonly AgentRuntime[];
    try {
      /* Bounded here, not by the probe: a discovery that ignores its signal still settles when the flight's deadline aborts it. */
      candidates = await waitForSignal(Promise.resolve(descriptor.detectRuntime(signal)), signal);
    } catch (cause) {
      signal.throwIfAborted();
      return this.finishMissing(
        backend,
        generation,
        "error",
        cause instanceof Error ? cause.message : String(cause)
      );
    }
    if (candidates.length === 0) {
      return this.finishMissing(backend, generation, "missing");
    }
    const diagnostics: string[] = [];
    let allFailedToStart = true;
    let unsupported:
      | Extract<InspectedCandidate, { kind: "unsupported" }>
      | undefined;
    for (const candidate of candidates.slice(0, MAX_RUNTIME_CANDIDATES)) {
      const inspected = await inspectRuntimeCandidate(
        this.dependencies,
        descriptor,
        candidate,
        signal
      );
      if (inspected.kind === "unusable") {
        allFailedToStart &&= Boolean(inspected.cannotStart);
        diagnostics.push(inspected.diagnostic);
        continue;
      }
      if (inspected.kind === "unsupported") {
        diagnostics.push(inspected.diagnostic);
        unsupported ??= inspected;
        continue;
      }
      return this.finishInstalled(
        backend,
        generation,
        inspected,
        signal
      );
    }
    const diagnosticSummary = summarizeCandidateDiagnostics(diagnostics);
    if (unsupported) {
      if (this.generation(backend) !== generation) return this.resolve(backend);
      this.evidence.update(backend, { capabilityKnowledge: "known", runtimeIssue: "unsupported",
        runtimeCheck: { phase: "complete", startedAt: this.evidence.now(), checkedAt: this.evidence.now(), expiresAt: this.evidence.now() + RUNTIME_TTL_MS } });
      const snapshot: PresentSnapshot = {
        runtimeStatus: "unsupported",
        runtime: unsupported.runtime,
        capabilities: unsupported.capabilities,
        authStatus: "unknown",
        generation,
        reason: `${unsupported.reason}。${diagnosticSummary}`,
      };
      return this.publish(backend, generation, {
        snapshot,
        identity: unsupported.identity,
      })
        ? snapshot
        : this.resolve(backend);
    }
    return this.finishMissing(
      backend,
      generation,
      "error",
      diagnostics.length > 0
        ? diagnosticSummary
        : `${descriptor.displayName} CLI 候选探测失败`,
      allFailedToStart ? "cannot-start" : "probe-failed"
    );
  }

  private async finishInstalled(
    backend: ProviderId,
    generation: number,
    candidate: Extract<InspectedCandidate, { kind: "installed" }>,
    signal: AbortSignal
  ) {
    const { runtime, capabilities, identity } = candidate;
    signal.throwIfAborted();
    if (this.generation(backend) !== generation) return this.resolve(backend);
    const environmentIdentity = await runtimeEnvironmentIdentity(backend, runtime);
    signal.throwIfAborted();
    if (this.generation(backend) !== generation) return this.resolve(backend);
    const previous = this.snapshots.get(backend);
    const previousEnvironment = this.environmentIdentities.get(backend);
    if ((previous?.identity && !sameIdentity(previous.identity, identity)) ||
      (previousEnvironment !== undefined && previousEnvironment !== environmentIdentity)) {
      generation += 1;
      this.generations.set(backend, generation);
      this.evidence.invalidate(backend, generation);
      this.purposeTargets.delete(backend);
      const runtimeFlight = this.flights.get(backend);
      if (runtimeFlight?.controller.signal === signal) runtimeFlight.generation = generation;
      const authFlight = this.authFlights.get(backend);
      // A check awaiting discovery belongs to the new runtime; a started check belongs to the old one.
      if (authFlight?.environmentGeneration !== undefined) {
        authFlight.controller.abort(new Error("Execution environment changed"));
        this.authFlights.delete(backend);
      } else if (authFlight && !authFlight.controller.signal.aborted) {
        this.evidence.update(backend, { authCheck: { phase: "queued", startedAt: this.evidence.now() } });
      }
    }
    this.environmentIdentities.set(backend, environmentIdentity);
    this.evidence.update(backend, { capabilityKnowledge: "known", runtimeIssue: undefined,
      runtimeCheck: { phase: "complete", startedAt: this.evidence.now(), checkedAt: this.evidence.now(), expiresAt: this.evidence.now() + RUNTIME_TTL_MS } });
    const snapshot: PresentSnapshot = {
      runtimeStatus: "installed", runtime, capabilities,
      reason: previous?.snapshot.generation === generation ? previous.snapshot.reason : undefined,
      authStatus: previous?.snapshot.generation === generation ? previous.snapshot.authStatus :
        this.authFlights.has(backend) && !this.authFlights.get(backend)!.controller.signal.aborted ? "checking" : "unknown", generation,
    };
    signal.throwIfAborted();
    if (!this.publish(backend, generation, { snapshot, identity })) return this.resolve(backend);
    const regular = await this.executionTarget(backend, this.snapshot(backend));
    const isolated = await this.executionTarget(backend, this.snapshot(backend), { ignoreUserConfig: true });
    if (this.generation(backend) === generation) {
      this.purposeTargets.set(backend, { regular, isolated });
      this.publish(backend, generation, this.snapshots.get(backend)!);
    }
    return this.snapshot(backend);
  }

  private finishMissing(
    backend: ProviderId,
    generation: number,
    runtimeStatus: "missing" | "error",
    reason?: string,
    issue: RuntimeIssue = "probe-failed"
  ): BackendRuntimeSnapshot | Promise<BackendRuntimeSnapshot> {
    if (this.generation(backend) !== generation) return this.resolve(backend);
    if (issue === "cannot-start") this.evidence.update(backend, { startup: {
      status: "cannot-start", environmentGeneration: generation, checkedAt: this.evidence.now(),
    } });
    const previous = this.snapshots.get(backend);
    const runtimeCheck = this.evidence.facts(backend).runtimeCheck;
    if (runtimeStatus === "error" && issue !== "cannot-start" && previous?.snapshot.runtimeStatus === "installed" &&
      (runtimeCheck?.expiresAt ?? 0) > this.evidence.now()) {
      this.evidence.update(backend, { runtimeIssue: issue, runtimeCheck: { ...runtimeCheck!, phase: "error" } });
      this.publish(backend, generation, { ...previous, snapshot: { ...previous.snapshot, reason } });
      return this.snapshot(backend);
    }
    this.evidence.update(backend, { capabilityKnowledge: "unknown", runtimeIssue: runtimeStatus === "error" ? issue : undefined,
      runtimeCheck: { phase: runtimeStatus === "error" ? "error" : "complete", startedAt: this.evidence.now(), checkedAt: this.evidence.now(), expiresAt: this.evidence.now() + RUNTIME_TTL_MS } });
    const snapshot: MissingSnapshot = {
      runtimeStatus,
      capabilities: this.snapshot(backend).capabilities,
      authStatus: runtimeStatus === "error" ? "error" : "unknown",
      generation,
      ...(reason ? { reason } : {}),
    };
    return this.publish(backend, generation, { snapshot })
      ? snapshot
      : this.resolve(backend);
  }

  private identity(executable: string, signal?: AbortSignal) {
    return this.dependencies.identity
      ? this.dependencies.identity(executable, signal)
      : executableIdentity(executable);
  }

  private optionalIdentity(executable: string, signal?: AbortSignal) {
    return optionalRuntimeIdentity(this.dependencies, executable, signal);
  }
}
