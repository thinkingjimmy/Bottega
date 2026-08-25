/**
 * [INPUT]: Depends on Codex runtime/env, JSONL app-server protocol, background lease, auxiliary supervisor, process-group, unified interactive Seatbelt and replaceable process launcher
 * [OUTPUT]: Provides CodexSkillsAppServer: Inertial direct connection by runtime `codex app-server`Initialization skills list+errors/write, changed subscriptions, recycling and security shutdowns are suspended for zero pending only
 * [POS]: The only process/JSON-RPC owner of the Codex native status behind Unified Skills; The codex-acp version of the lock is still only for chat data
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { ResolvedRuntime } from "../types";
import { codexEnvironment } from "../../codex-runtime";
import { acquireAgentProcessLease, registerAuxiliaryAgentProcess, type AgentProcessLease, type AuxiliaryProcessRegistration } from "../../agent-process-supervisor";
import { cleanProcessGroup } from "../../process-group";
import { wrapInteractiveWithSeatbelt } from "../sandbox/seatbelt";
import { asError } from "../../errors";

export type NativeCodexSkill = Readonly<{
  name: string;
  description: string;
  path: string;
  scope: "user" | "repo" | "system" | "admin";
  enabled: boolean;
  interface?: Readonly<{ displayName?: string }>;
}>;

type SkillsListResponse = { data: Array<{ cwd: string; skills: NativeCodexSkill[]; errors: unknown[] }> };
type Pending = { resolve(value: unknown): void; reject(cause: Error): void; timer: NodeJS.Timeout };

export type CodexSkillsAppServerOptions = Readonly<{
  workspace: string;
  controlRoot: string;
  readOnlyRoots: readonly string[];
  idleMs?: number;
  requestTimeoutMs?: number;
}>;

export type CodexSkillsAppServerDependencies = Readonly<{
  launch(
    command: string,
    args: readonly string[],
    options: Readonly<{ cwd: string; detached: true; env: NodeJS.ProcessEnv }>
  ): ChildProcessWithoutNullStreams;
}>;

const DEFAULT_DEPENDENCIES: CodexSkillsAppServerDependencies = {
  launch: (command, args, options) => spawn(command, [...args], options),
};

export class CodexSkillsAppServer {
  private child: ChildProcessWithoutNullStreams | null = null;
  private runtimeKey = "";
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly changedListeners = new Set<() => void>();
  private lease: AgentProcessLease | null = null;
  private unregister: AuxiliaryProcessRegistration | null = null;
  private settle: (() => void) | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private starting: Promise<void> | null = null;
  private stderr = "";

  constructor(
    private readonly options: CodexSkillsAppServerOptions,
    private readonly dependencies = DEFAULT_DEPENDENCIES
  ) {}

  onChanged(listener: () => void) {
    this.changedListeners.add(listener);
    return () => this.changedListeners.delete(listener);
  }

  async list(runtime: ResolvedRuntime, cwd: string, forceReload = false) {
    return (await this.listDetailed(runtime, cwd, forceReload)).skills;
  }

  async listDetailed(runtime: ResolvedRuntime, cwd: string, forceReload = false) {
    const result = await this.request(runtime, "skills/list", { cwds: [cwd], forceReload }) as SkillsListResponse;
    return {
      skills: result.data.flatMap((entry) => entry.skills),
      errors: result.data.flatMap((entry) => entry.errors),
    };
  }

  async write(runtime: ResolvedRuntime, path: string, enabled: boolean) {
    return this.request(runtime, "skills/config/write", { path, name: null, enabled }) as Promise<{ effectiveEnabled: boolean }>;
  }

  async close() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const child = this.child;
    if (!child) return;
    child.stdin.end();
    await Promise.race([
      new Promise<void>((resolve) => child.once("close", () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 1_500)),
    ]);
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      const result = await cleanProcessGroup(child.pid);
      if (!result.ok) throw result.error;
    }
  }

  private async request(runtime: ResolvedRuntime, method: string, params: unknown) {
    this.cancelIdleClose();
    await this.ensureStarted(runtime);
    /* initialize 是同一连接上的嵌套 request，它结束时可能刚挂回 idle timer；
       真正业务请求登记 pending 前必须再撤一次。 */
    this.cancelIdleClose();
    const child = this.child;
    if (!child?.stdin.writable) throw new Error("Codex Skills app-server 不可写");
    const id = this.nextId++;
    const timeoutMs = this.options.requestTimeoutMs ?? 12_000;
    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server ${method} 超时`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
    });
    child.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
    try {
      return await result;
    } finally {
      this.scheduleIdleClose();
    }
  }

  private async ensureStarted(runtime: ResolvedRuntime) {
    const key = `${runtime.executable}\0${runtime.version}`;
    if (this.child && this.runtimeKey === key) return;
    if (this.starting) {
      await this.starting;
      if (this.child && this.runtimeKey === key) return;
    }
    if (this.child) await this.close();
    this.starting = this.start(runtime, key).finally(() => { this.starting = null; });
    await this.starting;
  }

  private async start(runtime: ResolvedRuntime, key: string) {
    await mkdir(this.options.workspace, { recursive: true, mode: 0o700 });
    this.lease = await acquireAgentProcessLease("codex", "background");
    try {
      const env = codexEnvironment(runtime);
      const wrapped = wrapInteractiveWithSeatbelt({
        command: runtime.executable,
        args: ["app-server"],
        env,
        backend: "codex",
        permissionMode: "ask-for-approval",
        workspace: this.options.workspace,
        readOnlyRoots: [...this.options.readOnlyRoots],
        controlRoot: this.options.controlRoot,
        network: false,
      });
      const child = this.dependencies.launch(wrapped.command, wrapped.args, {
        cwd: this.options.workspace,
        detached: true,
        env,
      });
      child.on("error", () => undefined);
      this.child = child;
      this.runtimeKey = key;
      const settled = new Promise<void>((resolve) => { this.settle = resolve; });
      this.unregister = registerAuxiliaryAgentProcess("codex", child, settled);
      child.stderr.on("data", (chunk) => { this.stderr = `${this.stderr}${chunk}`.slice(-2_048); });
      createInterface({ input: child.stdout }).on("line", (line) => this.onLine(line));
      child.once("close", (code, signal) => this.onClose(code, signal));
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      await this.request(runtime, "initialize", {
        clientInfo: { name: "bottega", title: "Bottega", version: "0.1.0" },
      });
      child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
    } catch (cause) {
      const child = this.child;
      this.finalize(asError(cause));
      if (child?.pid && child.exitCode === null && child.signalCode === null) {
        await cleanProcessGroup(child.pid).catch(() => undefined);
      }
      throw cause;
    }
  }

  private onLine(line: string) {
    let message: { id?: unknown; result?: unknown; error?: { message?: unknown }; method?: unknown };
    try { message = JSON.parse(line); } catch { return; }
    if (message.method === "skills/changed") {
      for (const listener of this.changedListeners) listener();
      return;
    }
    if (!Number.isInteger(message.id)) return;
    const pending = this.pending.get(message.id as number);
    if (!pending) return;
    this.pending.delete(message.id as number);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(String(message.error.message ?? "Codex app-server 请求失败")));
    else pending.resolve(message.result);
  }

  private onClose(code: number | null, signal: NodeJS.Signals | null) {
    const detail = this.stderr.trim();
    this.finalize(new Error(`Codex Skills app-server 已退出（code=${code}, signal=${signal}）${detail ? `：${detail}` : ""}`));
  }

  private finalize(cause: Error) {
    this.cancelIdleClose();
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(cause);
    }
    this.pending.clear();
    this.child = null;
    this.runtimeKey = "";
    this.unregister?.();
    this.unregister = null;
    this.settle?.();
    this.settle = null;
    this.lease?.release();
    this.lease = null;
  }

  private scheduleIdleClose() {
    this.cancelIdleClose();
    if (this.pending.size > 0) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.pending.size === 0) void this.close().catch(() => undefined);
    }, this.options.idleMs ?? 10 * 60_000);
    this.idleTimer.unref?.();
  }

  private cancelIdleClose() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
}
