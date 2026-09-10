/**
 * [INPUT]: Depends on descriptors, supervised runtime probes, filesystem identity, bounded leases and the registry-owned availability ledger.
 * [OUTPUT]: Owns runtime/auth snapshots, command-derived setup capabilities, observable environment invalidation, credential reservations, scoped evidence and purpose eligibility.
 * [POS]: The only owner of the backends running time and discovery/auth subprocess; Chat, Section, Settings and Background tasks cannot detect CLI on their own
 */

import type {
  AgentBackendId,
  BackendInfo,
} from "../../../shared/agent-ipc";
import { createHash } from "node:crypto";
import { AGENT_BACKEND_ORDER, type HeadlessPurpose } from "../../../shared/agent-ipc";
import { RUNTIME_TTL_MS, type RuntimeIssue, type ExecutionTarget } from "../../../shared/agent-availability/types";
import { CHECK_QUEUE_MS, MAX_RUNTIME_CANDIDATES, RUNTIME_DISCOVERY_MS, FULL_CHECK_MS } from "./availability/budgets";
import { AvailabilityEvidence, type TurnEvidenceStart } from "./availability/evidence";
import { executionScope, runtimeEnvironmentIdentity, type ScopePlan } from "./availability/scope";
import { DISABLED_CAPABILITIES, candidateDiagnostic, summarizeCandidateDiagnostics, executableIdentity, sameIdentity, waitForSignal,
  type BackendRuntimeSnapshot, type RegistryDependencies, type StoredSnapshot, type RuntimeIdentity, type InspectedCandidate,
  type PresentSnapshot, type MissingSnapshot, type CandidateRuntime } from "./availability/runtime";
export { DISABLED_CAPABILITIES } from "./availability/runtime";
export type { BackendRuntimeSnapshot, DisabledCapabilities } from "./availability/runtime";
import { runtimeVersionAsync } from "./runtime-probe";
import type {
  AgentRuntime,
  BackendDescriptor,
  ResolvedRuntime,
  RuntimeConfirmation,
} from "./types";
import {
  acquireAgentProcessLease,
  reserveAgentCredentialUse,
  type AgentProcessLease,
} from "../agent-process-supervisor";

export class BackendRuntimeRegistry {
  private readonly generations = new Map<AgentBackendId, number>();
  private readonly snapshots = new Map<AgentBackendId, StoredSnapshot>();
  private readonly lastKnownCapabilities = new Map<AgentBackendId, BackendInfo["capabilities"]>();
  private readonly flights = new Map<
    AgentBackendId,
    {
      generation: number;
      controller: AbortController;
      promise: Promise<BackendRuntimeSnapshot>;
    }
  >();
  private readonly listeners = new Set<
    (backend: AgentBackendId, snapshot: BackendRuntimeSnapshot) => void
  >();
  private shuttingDown = false;
  readonly evidence: AvailabilityEvidence;
  private readonly environmentIdentities = new Map<AgentBackendId, string>();
  private readonly purposeTargets = new Map<AgentBackendId, { regular: ExecutionTarget; isolated: ExecutionTarget }>();
  private readonly authFlights = new Map<AgentBackendId, { controller: AbortController; promise: Promise<BackendRuntimeSnapshot>; environmentGeneration?: number }>();
  private readonly turnListeners = new Set<(event: import("../../../shared/agent-availability/types").TurnAvailabilityEvidence) => void>();

  constructor(private readonly dependencies: RegistryDependencies) { this.evidence = new AvailabilityEvidence(dependencies.now); }

  current(backend: AgentBackendId) {
    return this.snapshots.get(backend)?.snapshot;
  }

  subscribe(
    listener: (backend: AgentBackendId, snapshot: BackendRuntimeSnapshot) => void
  ) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  invalidate(backend: AgentBackendId) {
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

  snapshot(backend: AgentBackendId): BackendRuntimeSnapshot {
    return this.current(backend) ?? {
      runtimeStatus: "unknown", authStatus: "unknown", capabilities: this.lastKnownCapabilities.get(backend) ?? DISABLED_CAPABILITIES,
      generation: this.generation(backend), availability: this.evidence.facts(backend),
    };
  }

  listSnapshots(): BackendInfo[] {
    return AGENT_BACKEND_ORDER.map((backend) => {
      const snapshot = this.snapshot(backend);
      if (snapshot.runtimeStatus === "unknown") void this.resolve(backend).catch(() => undefined);
      return this.toBackendInfo(backend, snapshot);
    });
  }

  recheck(backend: AgentBackendId) { return this.fullCheck(backend, "user-recheck"); }

  fullCheck(backend: AgentBackendId, intent: "startup" | "user-recheck" | "login-return") {
    void intent;
    if (this.shuttingDown) return Promise.reject(new Error("Runtime registry is shutting down"));
    const existing = this.authFlights.get(backend);
    if (existing) return existing.promise;
    let credentialUse: ReturnType<typeof reserveAgentCredentialUse> | undefined;
    let ready: Promise<void>;
    try { credentialUse = reserveAgentCredentialUse(backend); ready = credentialUse.ready; }
    catch (cause) { ready = Promise.reject(cause); }
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(new Error("Availability check deadline exceeded")), FULL_CHECK_MS);
    const probe = this.evidence.beginProbe(backend);
    // Publish the discovery flight synchronously; warm reads must join it rather than invalidate this check.
    const discovery = this.resolve(backend, true);
    void discovery.catch(() => undefined);
    const promise = this.checkAuthentication(backend, probe, controller.signal, discovery, ready).finally(() => {
      credentialUse?.release();
      clearTimeout(deadline);
      if (this.authFlights.get(backend)?.promise === promise) this.authFlights.delete(backend);
    });
    this.authFlights.set(backend, { controller, promise });
    return promise;
  }

  cancelCheck(backend: AgentBackendId) {
    this.authFlights.get(backend)?.controller.abort(new Error("Availability check cancelled"));
  }

  private async checkAuthentication(backend: AgentBackendId, probe: number, signal: AbortSignal, discovery: Promise<BackendRuntimeSnapshot>, ready: Promise<void>) {
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
        if (backend === "codex" || backend === "claude") {
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
        const result = descriptor.auth ? await waitForSignal(descriptor.auth.check(snapshot.runtime, signal, authenticationStarted), signal) : { status: "unknown" as const };
        const target = await this.executionTarget(backend, snapshot);
        const auth = backend === "kimi" && !target.scopeKey && result.status !== "error"
          ? { ...result, status: "unknown" as const } : result;
        if (!this.evidence.confirm(backend, probe, snapshot.generation, auth.status, target.scopeKey)) return this.snapshot(backend);
        const latest = this.snapshots.get(backend)!;
        if (latest.snapshot.runtimeStatus !== "installed") return latest.snapshot;
        this.publish(backend, snapshot.generation, { ...latest, snapshot: { ...latest.snapshot, authStatus: auth.status, reason: auth.reason } });
      } finally { lease?.release(); }
    } catch (cause) {
      const flight = this.authFlights.get(backend);
      if (flight?.controller.signal === signal && flight.environmentGeneration === undefined) {
        expectedEnvironment = this.generation(backend);
      }
      if (this.evidence.confirm(backend, probe, expectedEnvironment, "error")) {
        const latest = this.snapshots.get(backend) ?? { snapshot: this.snapshot(backend) };
        this.publish(backend, latest.snapshot.generation, { ...latest, snapshot: { ...latest.snapshot, authStatus: "error",
          reason: cause instanceof Error ? cause.message : String(cause) } });
      }
    }
    return this.snapshot(backend);
  }

  resolve(backend: AgentBackendId, refresh = false): Promise<BackendRuntimeSnapshot> {
    if (this.shuttingDown) {
      return Promise.reject(new Error("Runtime Registry 正在退出"));
    }
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
    this.evidence.update(backend, { runtimeCheck: { phase: "queued", startedAt: this.evidence.now() } });
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
  private async confirmStored(
    backend: AgentBackendId,
    stored: BackendRuntimeSnapshot
  ): Promise<BackendRuntimeSnapshot> {
    const descriptor = this.dependencies.descriptorFor(backend);
    if (stored.runtimeStatus !== "installed") return stored;
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
    backend: AgentBackendId,
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
    backend: AgentBackendId,
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

  async executionTarget(backend: AgentBackendId, snapshot: BackendRuntimeSnapshot, plan: ScopePlan = {}): Promise<ExecutionTarget> {
    const stored = this.snapshots.get(backend);
    const identity = stored?.snapshot.generation === snapshot.generation ? stored.identity : undefined;
    const identityKey = identity ? createHash("sha256").update(JSON.stringify(identity, (_, value) => typeof value === "bigint" ? String(value) : value)).digest("hex") : undefined;
    const scopeKey = snapshot.runtimeStatus === "installed" && identityKey ? await executionScope(backend, snapshot.runtime, identityKey, plan) : undefined;
    return { backend, environmentGeneration: snapshot.generation, scopeKey, ...(plan.model ? { model: plan.model } : {}) };
  }

  async operationEligibility(backend: AgentBackendId, purpose: HeadlessPurpose | "app-binding", plan: ScopePlan = {}, snapshot = this.snapshot(backend)) {
    const target = await this.executionTarget(backend, snapshot, plan);
    return this.evidence.eligibility(target, snapshot.capabilities, purpose, snapshot.runtimeStatus === "installed");
  }

  subscribeTurnEvidence(listener: (event: import("../../../shared/agent-availability/types").TurnAvailabilityEvidence) => void) {
    this.turnListeners.add(listener);
    return () => this.turnListeners.delete(listener);
  }

  markTurnSuccess(backend: AgentBackendId, generation: number, start?: TurnEvidenceStart) {
    if (!start || start.target.backend !== backend || start.target.environmentGeneration !== generation) return false;
    return this.recordTurn(start, "success");
  }

  markAuthFailure(backend: AgentBackendId, generation: number, start?: TurnEvidenceStart) {
    if (!start || start.target.backend !== backend || start.target.environmentGeneration !== generation) return false;
    return this.recordTurn(start, "auth-required");
  }

  recordTurn(start: TurnEvidenceStart, outcome: import("../../../shared/agent-availability/types").TurnAvailabilityEvidence["outcome"], limit?: import("../../../shared/agent-ipc").UsageLimitInfo) {
    const event = this.evidence.finish(start, outcome, limit);
    if (!event) return false;
    const stored = this.snapshots.get(start.target.backend);
    if (stored) this.publish(start.target.backend, start.target.environmentGeneration, stored);
    for (const listener of this.turnListeners) listener(event);
    return true;
  }

  toBackendInfo(
    backend: AgentBackendId,
    snapshot: BackendRuntimeSnapshot
  ): BackendInfo {
    const descriptor = this.dependencies.descriptorFor(backend);
    return {
      id: backend,
      displayName: descriptor.displayName,
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

  private generation(backend: AgentBackendId) {
    return this.generations.get(backend) ?? 0;
  }

  private publish(
    backend: AgentBackendId,
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
    backend: AgentBackendId,
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
      this.evidence.update(backend, { runtimeCheck: { phase: "discovery", startedAt: this.evidence.now() } });
      return await this.discoverLeased(backend, generation, signal);
    } finally {
      lease.release();
    }
  }

  private async discoverLeased(
    backend: AgentBackendId,
    generation: number,
    signal: AbortSignal
  ) {
    const descriptor = this.dependencies.descriptorFor(backend);
    let candidates: readonly AgentRuntime[];
    try {
      candidates = await descriptor.detectRuntime(signal);
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
    let unsupported:
      | Extract<InspectedCandidate, { kind: "unsupported" }>
      | undefined;
    for (const candidate of candidates.slice(0, MAX_RUNTIME_CANDIDATES)) {
      const inspected = await this.inspectCandidate(
        descriptor,
        candidate,
        signal
      );
      if (inspected.kind === "unusable") {
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
        descriptor,
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
        : `${descriptor.displayName} CLI 候选探测失败`
    );
  }

  private async inspectCandidate(
    descriptor: BackendDescriptor,
    candidate: AgentRuntime,
    signal: AbortSignal
  ): Promise<InspectedCandidate> {
    let version: string | undefined;
    let identityBefore: RuntimeIdentity | undefined;
    let identityAfter: RuntimeIdentity | undefined;
    try {
      identityBefore = await this.optionalIdentity(
        candidate.executable,
        signal
      );
      signal.throwIfAborted();
      version = this.dependencies.version
        ? await this.dependencies.version(candidate, signal)
        : await runtimeVersionAsync(
            candidate,
            ["--version"],
            signal,
            descriptor.versionEnvironment?.(candidate)
          );
      signal.throwIfAborted();
      identityAfter = await this.optionalIdentity(
        candidate.executable,
        signal
      );
    } catch (cause) {
      signal.throwIfAborted();
      return {
        kind: "unusable",
        diagnostic: candidateDiagnostic(
          candidate,
          cause instanceof Error ? cause.message : String(cause)
        ),
      };
    }
    signal.throwIfAborted();
    if (!version || !identityBefore || !identityAfter) {
      return {
        kind: "unusable",
        diagnostic: candidateDiagnostic(
          candidate,
          `${version ? `version ${version}，` : ""}版本或文件身份探测失败`
        ),
      };
    }
    if (!sameIdentity(identityBefore, identityAfter)) {
      return {
        kind: "unusable",
        diagnostic: candidateDiagnostic(
          candidate,
          `version ${version}，文件身份在版本探测期间发生变化`
        ),
      };
    }
    const runtime: ResolvedRuntime = { ...candidate, version };
    const validation = descriptor.validateRuntime(runtime);
    const inspected: CandidateRuntime = {
      runtime,
      identity: identityAfter,
      capabilities: {
        ...descriptor.capabilitiesFor(runtime),
        // Setup commands are independent of ACP terminal-auth negotiation.
        terminalAuth: Boolean(descriptor.setup?.commands.login),
      },
    };
    return validation.status === "unsupported"
      ? {
          kind: "unsupported",
          reason: validation.reason,
          diagnostic: candidateDiagnostic(
            candidate,
            `version ${version}，${validation.reason}`
          ),
          ...inspected,
        }
      : { kind: "installed", ...inspected };
  }

  private async finishInstalled(
    backend: AgentBackendId,
    generation: number,
    descriptor: BackendDescriptor,
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
    backend: AgentBackendId,
    generation: number,
    runtimeStatus: "missing" | "error",
    reason?: string,
    issue: RuntimeIssue = "probe-failed"
  ): BackendRuntimeSnapshot | Promise<BackendRuntimeSnapshot> {
    if (this.generation(backend) !== generation) return this.resolve(backend);
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

  private async optionalIdentity(
    executable: string,
    signal?: AbortSignal
  ) {
    try {
      return await waitForSignal(this.identity(executable, signal), signal);
    } catch {
      signal?.throwIfAborted();
      return undefined;
    }
  }
}
