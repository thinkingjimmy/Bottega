/**
 * [INPUT]: Depends on Electron utilityProcess/MessageChannelMain (injected), Node crypto/fs, custody's probeProcessBirth and the host protocol
 * [OUTPUT]: Provides UtilityHost (single-flight start, stop with a caller-visible cause, invoke/event, busy, drain/resume and stderrTail),
 *           HostExit and UtilityHostPorts. busy includes startup, pending invocations and main-side message handling; drain refuses new
 *           invocations while existing calls, package RPC and host-owned events can finish. Activation RPC may run before hello;
 *           events arriving during activation wait for that same start before delivery.
 * [POS]: Owner of the ADR-RT-01 utility-process slot: fork only after readiness and digest verification; read pid at spawn; preserve
 *        pre-spawn stop intent; attribute exit from owner intent and exit code. composition.ts combines this slot's activity with holds
 *        and process custody before a package's settings restart.
 */
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { MessageChannelMain, MessagePortMain, UtilityProcess } from "electron";
import { probeProcessBirth, type ProcessBirth } from "../custody/identity";
import { bridgeMessageSchema, HOST_GRAMMAR, HOST_LAUNCH_CONTRACT, hostLaunchPlanSchema, type BridgeMessage, type HostLaunchPlan, type HostToBridge } from "./protocol";

export type HostExit = Readonly<{
  /** `stopped` only when the owner asked; any unsolicited exit is `crashed`, even with code 0 (a killed utility also reports 0). */
  reason: "stopped" | "crashed" | "handshake-timeout" | "launch-failed";
  code: number | null;
  pid: number | null;
}>;

export type UtilityHostPorts = Readonly<{
  whenReady(): Promise<void>;
  fork(modulePath: string, options: { serviceName: string; env: Record<string, string>; stdio: ["ignore", "pipe", "pipe"] }): UtilityProcess;
  channel(): MessageChannelMain;
  bootstrapPath: string;
  probe?: (pid: number) => ProcessBirth | null;
  helloTimeoutMs?: number;
  stopTimeoutMs?: number;
  /** Observation point right after fork, before the asynchronous `spawn` event (used to prove stop-before-spawn). */
  afterFork?(host: UtilityHost): void;
  /** Messages the owner must handle (rpc, process-*); invoke results are resolved here. */
  onMessage(message: Exclude<BridgeMessage, { t: "hello" | "refused" | "invoke-result" }>, reply: (message: HostToBridge) => void): void | Promise<void>;
  onExit(exit: HostExit): void;
}>;

const STDERR_LIMIT = 64 * 1024;

export class UtilityHost {
  private child: UtilityProcess | null = null;
  private port: MessagePortMain | null = null;
  private stopRequested = false;
  /** Why main stopped the host (a coded refusal such as extension-revoked); in-flight and later calls reject with it, not the raw exit. */
  private stopCause: Error | null = null;
  private helloTimedOut = false;
  private running = false;
  /** Between start() and fork: a stop requested here must prevent the fork, not race it. */
  private preparing = false;
  private exited: Promise<HostExit> | null = null;
  /** B-03: one start at a time; concurrent callers share it. */
  private starting: Promise<{ pid: number; birth: ProcessBirth | null }> | null = null;
  private stderr = "";
  private readonly invocations = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
  private draining = false;
  private requests = 0;
  private identity: { pid: number; birth: ProcessBirth | null } | null = null;
  lastExit: HostExit | null = null;

  constructor(readonly plan: HostLaunchPlan, private readonly ports: UtilityHostPorts) {
    hostLaunchPlanSchema.parse(plan);
  }

  get state() { return this.child ? this.running ? "running" : this.stopRequested ? "stopping" : "starting" : this.preparing ? "starting" : "idle"; }
  get pid() { return this.identity?.pid ?? null; }
  get birth() { return this.identity?.birth ?? null; }
  get busy() { return this.state === "starting" || this.invocations.size > 0 || this.requests > 0; }
  /** Fence new work without interrupting calls or completion events already owned by this host. */
  drain() { this.draining = true; }
  resume() { this.draining = false; }
  stderrTail() { return this.stderr; }

  /** Single-flight (B-03): a start while one is in progress returns that start; the host forks once. */
  start(): Promise<{ pid: number; birth: ProcessBirth | null }> {
    this.starting ??= this.startOnce().finally(() => { this.starting = null; });
    return this.starting;
  }

  private async startOnce(): Promise<{ pid: number; birth: ProcessBirth | null }> {
    if (this.exited) await this.exited; // one slot: a previous process must have exited first
    this.stopRequested = false; this.stopCause = null; this.helloTimedOut = false; this.running = false; this.stderr = ""; this.identity = null;
    this.preparing = true;
    try {
      await this.ports.whenReady(); // utilityProcess cannot be created before ready
      const actual = createHash("sha256").update(await readFile(this.plan.entry)).digest("hex");
      if (actual !== this.plan.entrySha256) throw new Error(`host entry digest changed for ${this.plan.hostId}`);
    } finally { this.preparing = false; }
    if (this.stopRequested) {
      this.lastExit = { reason: "stopped", code: null, pid: null };
      throw Object.assign(new Error(`host ${this.plan.hostId} stopped before fork`), { exit: this.lastExit });
    }
    const { port1, port2 } = this.ports.channel();
    const child = this.ports.fork(this.ports.bootstrapPath, { serviceName: `bottega-${this.plan.kind}-${this.plan.hostId}`,
      env: this.plan.env, stdio: ["ignore", "pipe", "pipe"] });
    this.child = child; this.port = port1;
    child.stderr?.on("data", (chunk: Buffer) => { this.stderr = (this.stderr + chunk.toString("utf8")).slice(-STDERR_LIMIT); });
    child.stdout?.on("data", () => {});
    let settleStart!: { resolve(value: { pid: number; birth: ProcessBirth | null }): void; reject(error: Error): void };
    const started = new Promise<{ pid: number; birth: ProcessBirth | null }>((resolve, reject) => { settleStart = { resolve, reject }; });
    const hello = setTimeout(() => { this.helloTimedOut = true; child.kill(); }, this.ports.helloTimeoutMs ?? 10_000);
    child.once("spawn", () => {
      /* pid exists only from here until exit. */
      const pid = child.pid!;
      this.identity = { pid, birth: (this.ports.probe ?? probeProcessBirth)(pid) };
      /* kill() before spawn returned false and did nothing: the stop intent is applied now. */
      if (this.stopRequested) { child.kill(); return; }
      child.postMessage({ t: "launch", grammar: HOST_GRAMMAR, contract: HOST_LAUNCH_CONTRACT.version, plan: this.plan } satisfies HostToBridge, [port2]);
    });
    port1.on("message", (event) => {
      const parsed = bridgeMessageSchema.safeParse(event.data);
      if (!parsed.success) { console.warn(`[host] ${this.plan.hostId} sent an invalid message`); return; }
      const message = parsed.data;
      /* The frozen launch contract (TASK-11): a host of another contract, or one refusing ours, never serves; the start fails naming both. */
      const mismatch = (theirs: string) => {
        settleStart.reject(new Error(`host ${this.plan.hostId} is under launch contract ${theirs}; main requires ${HOST_LAUNCH_CONTRACT.version}`));
        child.kill();
      };
      if (message.t === "refused") { mismatch(message.contract); return; }
      if (message.t === "hello") {
        if (message.contract !== HOST_LAUNCH_CONTRACT.version) { mismatch(message.contract); return; }
        if (message.hostId !== this.plan.hostId || message.pid !== this.identity?.pid) { child.kill(); return; }
        clearTimeout(hello); this.running = true; settleStart.resolve({ pid: this.identity.pid, birth: this.identity.birth });
        return;
      }
      if (message.t === "invoke-result") {
        const waiting = this.invocations.get(message.id); this.invocations.delete(message.id);
        if (message.ok) waiting?.resolve(message.result ?? null); else waiting?.reject(new Error(message.error ?? "invoke failed"));
        return;
      }
      // Activation may read settings before hello; all RPC still passes the owner's authority checks.
      if (this.stopRequested || (!this.running && message.t !== "rpc")) return;
      this.requests++;
      void (async () => this.ports.onMessage(message, reply => port1.postMessage(reply)))()
        .catch(cause => console.warn(`[host] ${this.plan.hostId} request failed`, cause))
        .finally(() => { this.requests--; });
    });
    port1.start();
    this.exited = new Promise<HostExit>(resolve => {
      child.once("exit", (code) => {
        clearTimeout(hello);
        const reason: HostExit["reason"] = this.stopRequested ? "stopped" : this.helloTimedOut ? "handshake-timeout" : this.running ? "crashed" : "launch-failed";
        const exit: HostExit = { reason, code, pid: this.identity?.pid ?? null };
        this.lastExit = exit; this.running = false; this.child = null;
        port1.close(); this.port = null;
        for (const waiting of this.invocations.values()) waiting.reject(this.stopCause ?? new Error(`host ${reason}`));
        this.invocations.clear();
        settleStart.reject(Object.assign(new Error(`host ${this.plan.hostId} ${reason} before hello`), { exit, stderr: this.stderr }));
        this.ports.onExit(exit);
        resolve(exit);
      });
    }).finally(() => { this.exited = null; });
    /* Still synchronous with fork, so still before the asynchronous `spawn` event, and exit wiring now exists. */
    this.ports.afterFork?.(this);
    return started;
  }

  /** Records intent first; a utility killed before `spawn` is killed again at `spawn`. */
  async stop(cause?: Error): Promise<HostExit | null> {
    if (cause) this.stopCause = cause;
    if (this.preparing) { this.stopRequested = true; return { reason: "stopped", code: null, pid: null }; }
    const child = this.child, exited = this.exited;
    if (!child || !exited) return this.lastExit;
    this.stopRequested = true;
    child.kill();
    const timeout = this.ports.stopTimeoutMs ?? 5_000;
    const outcome = await Promise.race([exited, new Promise<null>(resolve => setTimeout(() => resolve(null), timeout).unref())]);
    if (outcome) return outcome;
    /* SIGTERM ignored: SIGKILL, but only the process we started (same birth). */
    const identity = this.identity, probe = this.ports.probe ?? probeProcessBirth;
    if (identity?.birth && probe(identity.pid)?.birthIdentity === identity.birth.birthIdentity) process.kill(identity.pid, "SIGKILL");
    return exited;
  }

  invoke(method: string, params: unknown, refs: string[] = []): Promise<unknown> {
    if (this.draining) return Promise.reject(new Error(`host ${this.plan.hostId} is restarting`));
    return this.dispatch(method, params, refs);
  }

  /** Keep startup notifications with this host and let completion events pass the admission fence. */
  async event(params: unknown): Promise<unknown> {
    this.requests++;
    try {
      if (this.starting) await this.starting;
      return await this.dispatch("event", params, []);
    } finally { this.requests--; }
  }

  private dispatch(method: string, params: unknown, refs: string[]): Promise<unknown> {
    if (!this.port || !this.running || this.stopRequested) return Promise.reject(this.stopCause ?? new Error(`host ${this.plan.hostId} is not running`));
    const id = randomBytes(9).toString("base64url");
    return new Promise((resolve, reject) => {
      this.invocations.set(id, { resolve, reject });
      this.port!.postMessage({ t: "invoke", id, method, params, refs } satisfies HostToBridge);
    });
  }
}
