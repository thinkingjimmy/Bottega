/**
 * [INPUT]: Depends on Node crypto/fs/path, zod, the Provider admission gate (asked before every bridge start; a refusal is the Provider's named runtime-unavailable failure, d4-0) and the admitted bundled Provider packages (each bridge is started with its one Provider's module path and pinned digest, TASK-11 d2/d3; a refused package is that Provider's named runtime-unavailable failure), the utility host runtime, the operation runtime (refs + registry), the provider-turn principal, the bridge protocol (BridgedWork: a turn or a headless run) and BridgedAcpTurn
 * [OUTPUT]: Provides ProviderBridgeRuntime (ensure waits for the host's single start and shares one readiness proof per runtime identity, B-03, which a quota read or headless job skips with `prove: false` since neither speaks ACP; a bridge nobody uses stops after PROVIDER_BRIDGE_IDLE_STOP_MS, configurable through configureIdleStop) stop(providerId, cause) (d4a close-out: an unavailable Provider's bridge closes now, failing only its turns), and installedProviderBridge (the composed runtime or null) (ensure a Provider's bridge host and its readiness, turn principals, sealed execution refs, the two `provider.turn.*` operations, bridge-lost handling) plus installProviderBridge / requireProviderBridge
 * [POS]: The main-side owner of Provider bridges. One bridge host per Provider; readiness (initialize + session/list on a custody-mode process, from a per-Provider plan whose preparation is released after) runs once per bridge life and runtime identity before the first turn; a bridge's exit fails only its own Provider's turns
 */
import type { AgentTurnCustodyDependency } from "../../../../shared/apps/model/app-lifecycle";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { JsonValue } from "@ai-chat/cloud-protocol/contracts/canonical";
import type { HostRuntime } from "../../host/composition";
import { hostChildEnvironment } from "../../host/processes/process-port";
import type { UtilityHost } from "../../host/utility-host";
import type { OperationsRuntime } from "../../operations/composition";
import { OperationError } from "../../operations/registry";
import { awaitRecoveredAuthority, RecoveryPendingError } from "../../persistence/recovery-policy";
import { agentRuntimeFailure, diagnosticFailureDetails, ProductFailureError } from "../../../../shared/product/product-failure";
import { BundledProviderRefused } from "../../extensions/host/bundled-providers";
import { assertProviderAdmitted, assertProviderNotRevoked, ProviderAdmissionRefused } from "./admission";
import { providerTurnPrincipal, type VerifiedPrincipal } from "../../operations/principals";
import type { AgentProcessLaunch, TurnProcessOwner } from "../../backends/types";
import { providerHostId, PROVIDER_TURN_OPERATIONS, type BridgeTurnEvent, type BridgeTurnRequest } from "./protocol";
import type { BridgedWork } from "./protocol";

type Runtime = { executable: string; path: string; version: string };
type ReadinessPlan = { launch: AgentProcessLaunch; release?(): void | Promise<void> };
export const PROVIDER_BRIDGE_IDLE_STOP_MS = 5 * 60_000;
export type ProviderReadiness = { ok: true; pid: number | null; sessions: number; steering: boolean };

export class ProviderBridgeRuntime {
  private readonly turns = new Map<string, BridgedWork>(); // principal key → turn or headless run
  private readonly ready = new Map<string, { runtime: string; result: ProviderReadiness }>();
  private readonly readying = new Map<string, { runtime: string; proof: Promise<void> }>();
  /** How long a Provider's bridge may sit unused before it stops (TASK-11 flip ruling, 5 minutes). */
  private idleStopMs = PROVIDER_BRIDGE_IDLE_STOP_MS;
  private readonly idleTimers = new Map<string, NodeJS.Timeout>(); // hostId → pending stop
  private readonly stopping = new Map<string, Promise<unknown>>(); // hostId → stop in flight

  constructor(private readonly deps: { hosts: HostRuntime; operations: OperationsRuntime; mainDirectory: string;
    /** A built-in Provider's bridge module from its admitted bundled package; throws BundledProviderRefused when the package was refused. */
    packageBridge?(providerId: string): Promise<UtilityHost | null>;
    bridgeModule(providerId: string): Readonly<{ path: string; sha256: string }>;
    /** What proves a Provider ready: the launch main seals, and whatever it prepared for it (Kimi's disposable home) to release after. */
    readinessPlan(providerId: string, runtime: Runtime): Promise<ReadinessPlan> | ReadinessPlan }) {
    const registry = deps.operations.registry;
    const turnOf = (principal: VerifiedPrincipal, turnKey: string) => {
      const turn = this.turns.get(principal.key);
      if (!turn || turn.turnKey !== turnKey) throw new OperationError("principal-denied", "no live bridged turn for this ref");
      return turn;
    };
    registry.register({ name: PROVIDER_TURN_OPERATIONS.events, principals: ["agent-turn"], risk: "write",
      input: z.object({ turnKey: z.string().uuid(), events: z.array(z.unknown()).min(1).max(4_096) }).strict(),
      handler: ({ principal }, input) => { const turn = turnOf(principal, input.turnKey); for (const event of input.events) turn.apply(event as BridgeTurnEvent); return null; } });
    registry.register({ name: PROVIDER_TURN_OPERATIONS.request, principals: ["agent-turn"], risk: "write",
      input: z.object({ turnKey: z.string().uuid(), request: z.object({ k: z.string() }).passthrough() }).strict(),
      handler: async ({ principal }, input) => ((await turnOf(principal, input.turnKey).request(input.request as BridgeTurnRequest)) ?? null) as JsonValue });
    deps.hosts.onExit((hostId, reason) => {
      this.ready.delete(hostId);
      this.disarm(hostId);
      /* C8, G7: only this bridge's own Provider's turns are lost with it. */
      const lostProvider = hostId.startsWith(providerHostId("")) ? hostId.slice(providerHostId("").length) : null;
      if (lostProvider) for (const turn of [...this.turns.values()]) if (turn.providerId === lostProvider) turn.bridgeLost(reason);
    });
  }

  turnPrincipal(chat: { chatId: string; incarnationId: string }, requestId: string, turnKey: string, live: () => boolean) {
    return providerTurnPrincipal(chat, requestId, turnKey, live);
  }

  /** The execution ref carries the sealed launch; only this turn's principal can spend it, and it dies with the turn. */
  issue(principal: VerifiedPrincipal, target: { launch: AgentProcessLaunch; bind(owner: TurnProcessOwner): void;
    dependencies?: readonly AgentTurnCustodyDependency[] }, turn: BridgedWork) {
    this.turns.set(principal.key, turn);
    this.disarm(providerHostId(turn.providerId));
    return this.deps.operations.refs.issue("execution", principal, { ...target, providerId: turn.providerId });
  }

  forget(turn: BridgedWork) {
    for (const [key, value] of this.turns) if (value === turn) { this.turns.delete(key); this.deps.operations.refs.revokePrincipal(key); }
    this.arm(turn.providerId);
  }

  /* Idle stop (TASK-11 flip ruling): a bridge nobody uses stops after the idle period instead of holding its ~95 MiB until the app
     quits. "Nobody" means no live turn and no readiness proof of that Provider; its refs die with its turns. The next use starts a
     fresh bridge and proves readiness again. */
  private inUse(providerId: string) {
    return [...this.turns.values()].some(turn => turn.providerId === providerId) || this.readying.has(providerHostId(providerId));
  }

  private arm(providerId: string) {
    const hostId = providerHostId(providerId);
    this.disarm(hostId);
    if (this.inUse(providerId) || !this.deps.hosts.get(hostId)) return;
    const timer = setTimeout(() => {
      this.idleTimers.delete(hostId);
      if (this.inUse(providerId) || this.stopping.has(hostId)) return;
      const stop = this.deps.hosts.remove(hostId).catch(cause => console.warn(`[providers] ${hostId} idle stop failed`, cause))
        .finally(() => { this.ready.delete(hostId); this.stopping.delete(hostId); });
      this.stopping.set(hostId, stop);
    }, this.idleStopMs);
    timer.unref();
    this.idleTimers.set(hostId, timer);
  }

  /**
   * d4a close-out: a Provider that stopped being available (its package disabled, removed or refused) has its bridge closed now, not at
   * idle. The host's exit fails only this Provider's turns; a later ensure asks the admission gate again before anything starts.
   */
  async stop(providerId: string, cause: string) {
    const hostId = providerHostId(providerId);
    this.disarm(hostId);
    await this.stopping.get(hostId);
    if (!this.deps.hosts.get(hostId)) return;
    const stop = this.deps.hosts.remove(hostId, new Error(cause)).catch(error => console.warn(`[providers] ${hostId} stop failed`, error))
      .finally(() => { this.ready.delete(hostId); this.stopping.delete(hostId); });
    this.stopping.set(hostId, stop);
    await stop;
  }

  private disarm(hostId: string) {
    const timer = this.idleTimers.get(hostId);
    if (timer) { clearTimeout(timer); this.idleTimers.delete(hostId); }
  }

  /**
   * Starts the bridge if needed and proves the Provider ready on this runtime before the first turn (C10). A quota read or a headless
   * job speaks no ACP (the CLI's own app-server, control session or print mode), so it passes `prove: false`: its launch is sealed on
   * its own ref, and a failing ACP handshake must not take its usage numbers or titles with it.
   */
  private createBridge(hostId: string, providerId: string, entry: string) {
    let pin: Readonly<{ path: string; sha256: string }>;
    try { pin = this.deps.bridgeModule(providerId); } catch (cause) {
      /* P8: a missing or corrupt built-in package refuses its own Provider by name; nothing falls back to another path. */
      throw cause instanceof BundledProviderRefused || cause instanceof ProviderAdmissionRefused
        ? new ProductFailureError(agentRuntimeFailure("runtime-unavailable", diagnosticFailureDetails(cause))) : cause;
    }
    return this.deps.hosts.create({ hostId, kind: "provider-bridge", entry, entrySha256: createHash("sha256").update(readFileSync(entry)).digest("hex"),
      env: { ...hostChildEnvironment(), BOTTEGA_PROVIDER_ID: providerId, BOTTEGA_PROVIDER_MODULE: pin.path, BOTTEGA_PROVIDER_MODULE_SHA256: pin.sha256 } });
  }

  async ensure(providerId: string, principal: VerifiedPrincipal, runtime: Runtime, options: { prove?: boolean } = {}): Promise<UtilityHost> {
    /* Readiness and every turn launch custody processes: during startup recovery they wait for it here, in main, so a refusal past the
       bound reaches the turn as a named failure instead of a raw error relayed through the bridge. */
    await awaitRecoveredAuthority().catch((cause: unknown) => {
      throw cause instanceof RecoveryPendingError ? new ProductFailureError(agentRuntimeFailure(cause.reason)) : cause;
    });
    /* d4-0: the one admission question for every bridge start (a turn, a quota read, a headless job), before anything launches. */
    await assertProviderAdmitted(providerId).catch((cause: unknown) => {
      throw cause instanceof ProviderAdmissionRefused ? new ProductFailureError(agentRuntimeFailure("runtime-unavailable", diagnosticFailureDetails(cause))) : cause;
    });
    const hostId = providerHostId(providerId);
    this.disarm(hostId);
    /* A bridge stopping for idleness finishes first; this use then starts a fresh one. */
    await this.stopping.get(hostId);
    const entry = join(this.deps.mainDirectory, "provider-bridge-entry.js");
    /* The bridge runs this one Provider, from its admitted bundled package's module; it re-checks the bytes before evaluating them (d2, d3). */
    let host = await this.deps.packageBridge?.(providerId) ?? this.deps.hosts.get(hostId);
    if (!host) {
      /* d4c: synchronous with create, so a revocation that landed while this start waited above wins. */
      try { assertProviderNotRevoked(providerId); } catch (cause) {
        throw new ProductFailureError(agentRuntimeFailure("runtime-unavailable", diagnosticFailureDetails(cause)));
      }
      host = this.createBridge(hostId, providerId, entry);
    }
    /* B-03: every caller waits for the same start (single-flight in the host), never only the first. */
    if (host.state !== "running") await host.start();
    const identity = `${runtime.executable}@${runtime.version}`;
    if (options.prove !== false && this.ready.get(hostId)?.runtime !== identity) {
      /* Concurrent first turns share one readiness proof per runtime identity. */
      let flight = this.readying.get(hostId);
      if (flight?.runtime !== identity) {
        const proof = (async () => {
          let plan: ReadinessPlan | null = null, ref: string | null = null;
          try {
            /* A plan may prepare something first (Kimi's disposable home); whatever it prepared is released however the proof ends. */
            plan = await this.deps.readinessPlan(providerId, runtime);
            ref = this.deps.operations.refs.issue("execution", principal, { launch: plan.launch, providerId });
            this.ready.set(hostId, { runtime: identity, result: await host.invoke("readiness", { backend: providerId }, [ref]) as ProviderReadiness });
          } finally {
            if (ref) this.deps.operations.refs.revoke(ref);
            await plan?.release?.();
            if (this.readying.get(hostId) === flight) this.readying.delete(hostId);
          }
        })();
        flight = { runtime: identity, proof };
        this.readying.set(hostId, flight);
      }
      await flight.proof;
    }
    /* A readiness-only use (a warm-up, a probe) is idle like any other once proven; a turn issued now disarms it again. */
    this.arm(providerId);
    return host;
  }

  /** Production configuration of the idle period; the E2E driver shortens it to observe a stop in seconds. */
  configureIdleStop(ms: number) { this.idleStopMs = ms; }

  readiness(providerId: string) { return this.ready.get(providerHostId(providerId))?.result ?? null; }
}

let installed: ProviderBridgeRuntime | null = null;
/** Startup installs the composed runtime; null uninstalls it (a suite restoring the state it found). */
export const installProviderBridge = (runtime: ProviderBridgeRuntime | null) => { installed = runtime; };
/** The composed runtime, or null before startup composed it (a warm-up hint then does nothing). */
export const installedProviderBridge = () => installed;
/** Every Provider runs on its bridge; there is no in-process path to fall back to when it is missing (C11). */
export function requireProviderBridge() {
  if (!installed) throw new Error("the Provider bridge was not composed");
  return installed;
}
