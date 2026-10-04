/**
 * [INPUT]: Depends on Electron app/utilityProcess/MessageChannelMain, the operation runtime (refs + registry), the descendant registry,
 *          process custody, PackagePorts holds, abortable timer waits, the process port and UtilityHost.
 * [OUTPUT]: Provides hostExitCleanup and createHostRuntime / HostRuntime: initialize/create/get/remove/close, isIdle/drain across host
 *           activity, package holds and both process owners, package-port attachment and exit subscriptions. remove shares concurrent
 *           disposal and preserves a replacement slot; package RPC uses its channel owner and ref-less RPC its App-surface principal.
 * [POS]: The single owner of utility hosts in main; routes every bridge request through a capability ref to the principal it was issued for, starts custody-mode processes through the guardian (a Provider bridge only as the launch main sealed on its execution ref, whose turn is then bound to that child's host-custody owner, B2-01), tells onExit listeners about every host exit, and cleans a host's process groups whenever that host exits
 */
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { app, MessageChannelMain, utilityProcess } from "electron";
import type { OperationsRuntime } from "../operations/composition";
import { DescendantRegistry } from "./processes/descendants";
import { HostProcessPort } from "./processes/process-port";
import { HostProcessCustody, type HostCustodyDependencyPorts } from "./processes/custody";
import type { AgentTurnCustodyDependency } from "../../../shared/apps/model/app-lifecycle";
import { runtimePort } from "../runtime";
import { fencePackageLaunch, type PackageFence } from "./package/launch";
import { packageTransport } from "./package/transport";
import { UtilityHost } from "./utility-host";
import type { BridgeMessage, HostLaunchPlan, HostToBridge } from "./protocol";
import { isPackagePortOperation, type PackagePorts } from "../extensions/host/ports";
import { hostPackagePrincipal } from "../operations/principals";
import type { TurnProcessOwner } from "../backends/types";

export type HostRuntime = ReturnType<typeof createHostRuntime>;
type PackagePortBinding = Readonly<{
  ports: PackagePorts;
  caller(hostId: string): (Parameters<PackagePorts["dispatch"]>[0] & { generationId: string }) | null;
}>;

/**
 * Who cleans a stopped host's process groups. A stop main asked for (`remove`, `close`) is cleaned by that caller once the host is
 * gone; the exit listener then leaves it alone, so a quit never cleans a second time after the custody journal has closed. An exit
 * nobody asked for (a crash) is cleaned by the listener.
 */
export function hostExitCleanup(ports: { cleanHost(hostId: string): Promise<unknown>; warn(...args: unknown[]): void }) {
  const owned = new Map<string, number>();
  return {
    /** Marks a stop as owned by its caller until the returned release. */
    own(hostId: string) { owned.set(hostId, (owned.get(hostId) ?? 0) + 1);
      return () => { const count = (owned.get(hostId) ?? 1) - 1; if (count > 0) owned.set(hostId, count); else owned.delete(hostId); }; },
    onExit(hostId: string) {
      if (owned.has(hostId)) return;
      void ports.cleanHost(hostId).catch(cause => ports.warn(`[host] ${hostId} descendant cleanup failed`, cause));
    },
    clean: (hostId: string) => ports.cleanHost(hostId),
  };
}

export function createHostRuntime(options: { userData: string; mainDirectory: string; operations: OperationsRuntime; helloTimeoutMs?: number;
  /** The App service's answers for custody dependencies; bound before `initialize` releases a settled request's. */
  dependencies?: HostCustodyDependencyPorts }) {
  const descendants = new DescendantRegistry(options.userData);
  const custody = new HostProcessCustody({ userData: options.userData, mainDirectory: options.mainDirectory });
  if (options.dependencies) custody.bindDependencies(options.dependencies);
  const processes = new HostProcessPort(descendants, custody);
  const hosts = new Map<string, { host: UtilityHost; aborts: AbortController; fence?: PackageFence }>();
  const exits = hostExitCleanup({ cleanHost: hostId => processes.cleanHost(hostId), warn: (...args) => console.warn(...args) });
  let closed = false;
  /* Late-bound: the Extension integration that owns host packages is composed after this runtime. */
  let packagePorts: PackagePortBinding | null = null;
  const exitListeners = new Set<(hostId: string, reason: string) => void>();
  const removals = new Map<string, Promise<Awaited<ReturnType<UtilityHost["stop"]>>>>();

  const isIdle = (hostIds: readonly string[]) => hostIds.every(hostId => !hosts.get(hostId)?.host.busy
    && !packagePorts?.ports.held(hostId) && !descendants.list(hostId).some(record => !record.processId.startsWith("host_"))
    && !custody.entries().some(entry => entry.hostId === hostId && entry.phase !== "aborted" && entry.phase !== "released"));

  const remove = (hostId: string, cause?: Error) => {
    const pending = removals.get(hostId);
    if (pending) return pending;
    const entry = hosts.get(hostId);
    if (!entry) return Promise.resolve(null);
    const release = exits.own(hostId);
    const removal = (async () => {
      try {
        const exit = await entry.host.stop(cause);
        await exits.clean(hostId);
        if (hosts.get(hostId) === entry) hosts.delete(hostId);
        return exit;
      } finally { release(); removals.delete(hostId); }
    })();
    removals.set(hostId, removal);
    return removal;
  };

  const handle = async (hostId: string, signal: AbortSignal, message: Exclude<BridgeMessage, { t: "hello" | "refused" | "invoke-result" }>, reply: (message: HostToBridge) => void) => {
    const { refs, registry } = options.operations;
    if (message.t === "rpc") {
      const caller = packagePorts?.caller(hostId);
      /* Package ports act for the package that owns this host channel; the caller never names a package. */
      if (caller && isPackagePortOperation(message.request.operation)) {
        const response = await packagePorts!.ports.dispatch(caller, message.request);
        if (!signal.aborted) reply({ t: "rpc-result", response });
        return;
      }
      const execution = message.request.refs?.[0];
      let response;
      try {
        /* A package host with no execution ref acts as itself: its own principal, only as long as main still attributes
           this channel to the same package generation. Grants, not the channel, decide what that principal may reach. */
        if (!execution && caller) {
          const principal = hostPackagePrincipal(caller, () => packagePorts?.caller(hostId)?.generationId === caller.generationId);
          response = await registry.dispatch(principal, message.request, signal);
          if (!signal.aborted) reply({ t: "rpc-result", response });
          return;
        }
        if (!execution) throw Object.assign(new Error("an execution ref is required"), { code: "capability-invalid" });
        /* The execution ref names the principal at this boundary; the operation sees only its own refs. */
        response = await registry.dispatch(refs.principal(execution, "execution"), { ...message.request, refs: message.request.refs!.slice(1) }, signal);
      } catch (cause) {
        const code = (cause as { code?: string }).code === "capability-revoked" ? "capability-revoked" as const : "capability-invalid" as const;
        response = { v: 1 as const, id: message.request.id, ok: false as const, error: { code, message: (cause as Error).message } };
      }
      if (!signal.aborted) reply({ t: "rpc-result", response });
    } else if (message.t === "process-spawn") {
      try {
        const fence = hosts.get(hostId)?.fence;
        if (fence && !message.plan) throw new Error("package-process-plan-required");
        const principal = refs.principal(message.ref, "execution");
        principal.assertCurrent();
        /* A Provider bridge never names what runs: it asks for the launch main sealed on the ref (C2, C3). */
        let spec: Parameters<typeof processes.spawn>[1] = message;
        let bind: ((owner: TurnProcessOwner) => void) | undefined;
        if (message.plan) {
          const target = refs.resolve<{ providerId?: string; launch?: { command: string; args: readonly string[]; cwd: string; env: NodeJS.ProcessEnv }; bind?(owner: TurnProcessOwner): void;
            dependencies?: readonly AgentTurnCustodyDependency[] }>(message.ref, "execution", principal);
          const launch = target?.launch;
          if (fence && (!fence.providerId || target?.providerId !== fence.providerId)) throw new Error("package-process-owner-mismatch");
          bind = target?.bind;
          if (!launch) throw new Error("this execution ref carries no sealed launch");
          /* A turn's launch (it binds an owner) records its request in host custody, so the process stays findable by it; readiness does not. */
          spec = { command: launch.command, args: [...launch.args], cwd: launch.cwd, custody: true, exactEnv: true, requestId: bind && principal.principal.kind === "agent-turn" ? principal.principal.turnId : null,
            env: Object.fromEntries(Object.entries(launch.env).flatMap(([key, value]) => typeof value === "string" ? [[key, value]] : [])),
            /* The work's dependencies travel main-side on the ref and are journaled with the process (ruling (a)); never in a bridge message. */
            dependencies: target.dependencies ?? [] };
        }
        const { processId, pid, identity } = await processes.spawn(hostId, spec, reply);
        /* B2-01: the turn that sealed this launch owns its process through host custody; it stops only by that owner. */
        if (bind && identity) bind({ identity, settle: () => processes.settleCustody(processId) });
        reply({ t: "process-spawned", id: message.id, ok: true, processId, pid });
      } catch (cause) {
        reply({ t: "process-spawned", id: message.id, ok: false, error: (cause as Error).message });
      }
    } else if (message.t === "process-stdin") {
      processes.write(hostId, message.processId, message.data, message.end);
    } else if (message.t === "process-kill") {
      await processes.kill(hostId, message.processId);
    }
  };

  return {
    descendants, custody,
    /** Before any host starts: groups a crashed previous life left behind are cleaned by PGID + birth, custody entries converge. */
    initialize: async () => { const cleaned = await descendants.reconcile(); await custody.initialize(); return cleaned; },
    create(plan: HostLaunchPlan, overrides: { helloTimeoutMs?: number; afterFork?(host: UtilityHost): void; packageFence?: PackageFence } = {}) {
      if (closed) throw new Error("host runtime is closed");
      if (hosts.has(plan.hostId)) throw new Error(`host ${plan.hostId} already exists`);
      let aborts = new AbortController();
      const transport = overrides.packageFence ? packageTransport(() => {
        const node = runtimePort().node(), entry = runtimePort().entryPath("package-host");
        return fencePackageLaunch({ command: node.path, args: ["--permission", "--allow-fs-read=*", "--allow-fs-write=*", "--disable-proto=throw", entry], cwd: overrides.packageFence!.readRoots[0]!, env: plan.env },
          { ...overrides.packageFence!, readRoots: [...overrides.packageFence!.readRoots, entry] });
      }, { record: pid => descendants.record({ hostId: plan.hostId, processId: `host_${pid}`, pid, command: runtimePort().node().path }) }) : null;
      const host = new UtilityHost(plan, {
        whenReady: () => app.whenReady(),
        fork: (modulePath, forkOptions) => utilityProcess.fork(modulePath, [], forkOptions),
        channel: () => new MessageChannelMain(),
        ...transport,
        bootstrapPath: join(options.mainDirectory, "utility-host-entry.js"),
        helloTimeoutMs: overrides.helloTimeoutMs ?? options.helloTimeoutMs,
        afterFork: overrides.afterFork,
        onMessage: (message, reply) => {
          return handle(plan.hostId, aborts.signal, message, reply);
        },
        onExit: (exit) => {
          aborts.abort(new Error(`host ${exit.reason}`)); aborts = new AbortController();
          for (const listener of exitListeners) { try { listener(plan.hostId, exit.reason); } catch (cause) { console.warn("[host] exit listener failed", cause); } }
          packagePorts?.ports.release(plan.hostId);
          /* Stopped or crashed alike, the host's process groups do not outlive it: a stop main asked for is cleaned by its caller. */
          exits.onExit(plan.hostId);
        },
      });
      hosts.set(plan.hostId, { host, aborts, fence: overrides.packageFence });
      return host;
    },
    get: (hostId: string) => hosts.get(hostId)?.host ?? null,
    isIdle,
    async drain(hostIds: readonly string[], signal: AbortSignal) {
      for (const hostId of hostIds) hosts.get(hostId)?.host.drain();
      while (!isIdle(hostIds)) await delay(25, undefined, { signal });
      signal.throwIfAborted();
    },
    attachPackagePorts(binding: PackagePortBinding) { packagePorts = binding; },
    /** Owners of a host's work (a Provider bridge's live turns) hear every exit, crash or stop. */
    onExit(listener: (hostId: string, reason: string) => void) { exitListeners.add(listener); return () => { exitListeners.delete(listener); }; },
    /** `cause` is what callers of the stopped host see (a coded refusal), instead of the raw exit reason. */
    remove,
    async close() {
      closed = true;
      await Promise.allSettled([...hosts.keys()].map(hostId => remove(hostId)));
      await custody.close();
    },
  };
}
