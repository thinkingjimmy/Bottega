/**
 * [INPUT]: Depends on the descriptor's canceled backup when running/version disabled/read-only authentication extension, fs realpath+stat and shared status
 * [OUTPUT]: Provides BackendRuntimeRegistry, dual identity around version first-valid runtime selection, isolated discovery error, caller deadline canceled spawn/identity CAS, generation/snapshot CAS, flight Abort/drain with unified renderer projection
 * [POS]: The only owner of the backends running time and discovery/auth subprocess; Chat, Section, Settings and Background tasks cannot detect CLI on their own
 */

import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { sep } from "node:path";
import type {
  AgentBackendId,
  BackendAuthStatus,
  BackendCapabilities,
  BackendInfo,
} from "../../../shared/agent-ipc";
import { runtimeVersionAsync } from "./runtime-probe";
import type {
  AgentRuntime,
  BackendDescriptor,
  ResolvedRuntime,
  RuntimeConfirmation,
} from "./types";
import {
  acquireAgentProcessLease,
  type AgentProcessLease,
} from "../agent-process-supervisor";

export type DisabledCapabilities = BackendCapabilities & {
  resume: false;
  permissionModes: [];
  modelOptions: "none";
  imageInput: false;
  planMode: false;
  headless: [];
  maintenance: false;
  builtinTools: "none";
};

export const DISABLED_CAPABILITIES: DisabledCapabilities = {
  resume: false,
  permissionModes: [],
  modelOptions: "none",
  imageInput: false,
  planMode: false,
  headless: [],
  maintenance: false,
  builtinTools: "none",
};

type RuntimeIdentity = {
  realpath: string;
  dev: bigint;
  ino: bigint;
  mtimeMs: number;
  size: number;
};

type MissingSnapshot = {
  runtimeStatus: "missing" | "error";
  runtime?: never;
  capabilities: DisabledCapabilities;
  authStatus: "unknown" | "error";
  generation: number;
  reason?: string;
};

type PresentSnapshot = {
  runtimeStatus: "unsupported" | "installed";
  runtime: ResolvedRuntime;
  capabilities: BackendCapabilities;
  authStatus: BackendAuthStatus;
  generation: number;
  reason?: string;
};

export type BackendRuntimeSnapshot = MissingSnapshot | PresentSnapshot;

type StoredSnapshot = {
  snapshot: BackendRuntimeSnapshot;
  identity?: RuntimeIdentity;
};

type CandidateRuntime = {
  runtime: ResolvedRuntime;
  identity: RuntimeIdentity;
  capabilities: BackendCapabilities;
};

type InspectedCandidate =
  | { kind: "unusable"; diagnostic: string }
  | ({ kind: "installed" } & CandidateRuntime)
  | ({
      kind: "unsupported";
      reason: string;
      diagnostic: string;
    } & CandidateRuntime);

const MAX_CANDIDATE_DIAGNOSTICS = 12;
const MAX_CANDIDATE_DIAGNOSTIC_LENGTH = 240;

function compactDiagnostic(value: string) {
  const home = homedir();
  const privateValue = home ? value.replaceAll(home, "~") : value;
  const compact = privateValue.replace(/\s+/g, " ").trim();
  return compact.length <= MAX_CANDIDATE_DIAGNOSTIC_LENGTH
    ? compact
    : `${compact.slice(0, MAX_CANDIDATE_DIAGNOSTIC_LENGTH - 1)}…`;
}

function displayExecutable(executable: string) {
  const home = homedir();
  return home && executable.startsWith(`${home}${sep}`)
    ? `~${executable.slice(home.length)}`
    : executable;
}

function candidateDiagnostic(candidate: AgentRuntime, detail: string) {
  return compactDiagnostic(`${displayExecutable(candidate.executable)}：${detail}`);
}

function summarizeCandidateDiagnostics(diagnostics: readonly string[]) {
  const visible = diagnostics.slice(0, MAX_CANDIDATE_DIAGNOSTICS);
  const omitted = diagnostics.length - visible.length;
  return `候选诊断：${visible.join("；")}${
    omitted > 0 ? `；另有 ${omitted} 个候选已省略` : ""
  }`;
}

type RegistryDependencies = {
  descriptorFor(id: AgentBackendId): BackendDescriptor;
  version?(
    runtime: Parameters<typeof runtimeVersionAsync>[0],
    signal?: AbortSignal
  ): Promise<string | undefined>;
  identity?(
    executable: string,
    signal?: AbortSignal
  ): Promise<RuntimeIdentity>;
  acquireLease?(
    backend: AgentBackendId,
    kind: "interactive",
    signal?: AbortSignal
  ): Promise<AgentProcessLease>;
};

const backgroundCapabilities = (
  capabilities: BackendCapabilities,
  authStatus: BackendAuthStatus
): BackendCapabilities =>
  authStatus === "authenticated"
    ? capabilities
    : { ...capabilities, headless: [], maintenance: false };

async function executableIdentity(executable: string): Promise<RuntimeIdentity> {
  const canonical = await realpath(executable);
  const metadata = await stat(canonical, { bigint: true });
  return {
    realpath: canonical,
    dev: metadata.dev,
    ino: metadata.ino,
    mtimeMs: Number(metadata.mtimeMs),
    size: Number(metadata.size),
  };
}

function sameIdentity(left: RuntimeIdentity, right: RuntimeIdentity) {
  return (
    left.realpath === right.realpath &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mtimeMs === right.mtimeMs &&
    left.size === right.size
  );
}

function waitForSignal<T>(promise: Promise<T>, signal?: AbortSignal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    const settle = <TValue>(
      next: (value: TValue) => void,
      value: TValue
    ) => {
      signal.removeEventListener("abort", abort);
      next(value);
    };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => settle(resolve, value),
      (cause) => settle(reject, cause)
    );
  });
}

function legacyStatus(snapshot: BackendRuntimeSnapshot): BackendInfo["status"] {
  if (snapshot.runtimeStatus !== "installed") return snapshot.runtimeStatus;
  if (snapshot.authStatus === "unauthenticated") return "auth-required";
  if (snapshot.authStatus === "error") return "error";
  return "ready";
}

export class BackendRuntimeRegistry {
  private readonly generations = new Map<AgentBackendId, number>();
  private readonly snapshots = new Map<AgentBackendId, StoredSnapshot>();
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

  constructor(private readonly dependencies: RegistryDependencies) {}

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
    this.flights
      .get(backend)
      ?.controller.abort(new Error(`${backend} runtime generation 已失效`));
    this.flights.delete(backend);
    return generation;
  }

  recheck(backend: AgentBackendId) {
    this.invalidate(backend);
    return this.resolve(backend);
  }

  resolve(backend: AgentBackendId): Promise<BackendRuntimeSnapshot> {
    if (this.shuttingDown) {
      return Promise.reject(new Error("Runtime Registry 正在退出"));
    }
    const generation = this.generation(backend);
    const existing = this.flights.get(backend);
    if (existing?.generation === generation) return existing.promise;
    const stored = this.snapshots.get(backend)?.snapshot;
    if (
      stored?.generation === generation &&
      stored.authStatus !== "checking"
    ) {
      return this.confirmStored(backend, stored);
    }
    const controller = new AbortController();
    const promise = this.discover(
      backend,
      generation,
      controller.signal
    )
      .catch((cause) => {
        if (controller.signal.aborted && !this.shuttingDown) {
          return this.resolve(backend);
        }
        throw cause;
      })
      .finally(() => {
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
    if (stored.runtimeStatus !== "installed" || !descriptor.confirmRuntime) {
      return stored;
    }
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
      "CLI 文件身份在 spawn 前持续变化，已拒绝启动"
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
    return true;
  }

  async shutdown() {
    this.shuttingDown = true;
    const flights = [...this.flights.values()];
    for (const flight of flights) {
      flight.controller.abort(new Error("Runtime Registry 正在退出"));
    }
    await Promise.allSettled(flights.map((flight) => flight.promise));
  }

  reopen() {
    if (this.flights.size > 0) return false;
    this.shuttingDown = false;
    return true;
  }

  markTurnSuccess(backend: AgentBackendId, generation: number) {
    return this.updateAuth(backend, generation, "authenticated");
  }

  markAuthFailure(backend: AgentBackendId, generation: number) {
    return this.updateAuth(backend, generation, "unauthenticated");
  }

  toBackendInfo(
    backend: AgentBackendId,
    snapshot: BackendRuntimeSnapshot
  ): BackendInfo {
    const descriptor = this.dependencies.descriptorFor(backend);
    return {
      id: backend,
      displayName: descriptor.displayName,
      status: legacyStatus(snapshot),
      runtimeStatus: snapshot.runtimeStatus,
      authStatus: snapshot.authStatus,
      capabilities: backgroundCapabilities(
        snapshot.capabilities,
        snapshot.authStatus
      ),
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
      )(backend, "interactive", signal);
    } catch (cause) {
      signal.throwIfAborted();
      return this.finishMissing(
        backend,
        generation,
        "error",
        cause instanceof Error ? cause.message : String(cause)
      );
    }
    try {
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
    for (const candidate of candidates) {
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
        terminalAuth: descriptor.sessionCapabilityPolicy.terminalAuth,
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
    const checking: PresentSnapshot = {
      runtimeStatus: "installed",
      runtime,
      capabilities,
      authStatus: descriptor.auth ? "checking" : "unknown",
      generation,
    };
    if (!this.publish(backend, generation, { snapshot: checking, identity })) {
      return this.resolve(backend);
    }
    if (!descriptor.auth) return checking;
    let auth;
    try {
      auth = await descriptor.auth.check(runtime, signal);
    } catch (cause) {
      signal.throwIfAborted();
      auth = {
        status: "error" as const,
        reason: cause instanceof Error ? cause.message : String(cause),
      };
    }
    const final: PresentSnapshot = {
      ...checking,
      authStatus: auth.status,
      ...(auth.reason ? { reason: auth.reason } : {}),
    };
    return this.publish(backend, generation, { snapshot: final, identity })
      ? final
      : this.resolve(backend);
  }

  private finishMissing(
    backend: AgentBackendId,
    generation: number,
    runtimeStatus: "missing" | "error",
    reason?: string
  ): BackendRuntimeSnapshot | Promise<BackendRuntimeSnapshot> {
    const snapshot: MissingSnapshot = {
      runtimeStatus,
      capabilities: DISABLED_CAPABILITIES,
      authStatus: runtimeStatus === "error" ? "error" : "unknown",
      generation,
      ...(reason ? { reason } : {}),
    };
    return this.publish(backend, generation, { snapshot })
      ? snapshot
      : this.resolve(backend);
  }

  private updateAuth(
    backend: AgentBackendId,
    generation: number,
    authStatus: BackendAuthStatus
  ) {
    if (
      this.dependencies.descriptorFor(backend).auth?.turnEvidence === "provider"
    ) {
      return false;
    }
    const stored = this.snapshots.get(backend);
    if (
      !stored ||
      stored.snapshot.runtimeStatus !== "installed" ||
      stored.snapshot.generation !== generation
    ) {
      return false;
    }
    return this.publish(backend, generation, {
      ...stored,
      snapshot: {
        ...stored.snapshot,
        authStatus,
        ...(authStatus === "authenticated" ? { reason: undefined } : {}),
      },
    });
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
