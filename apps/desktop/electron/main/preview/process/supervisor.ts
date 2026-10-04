/**
 * [INPUT]: Frozen turn fences, shared Seatbelt profile builder, process birth identities and orphan watchdog.
 * [OUTPUT]: PreviewServerSupervisor with bounded Chat-owned launches, exact identities, listener-loss notification and awaited shutdown.
 * [POS]: Managed services outlive their Agent turn but never the desktop or the frozen workspace authority.
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { realpath, access } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, dirname, isAbsolute, join, relative } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { buildSeatbeltProfile } from "../../backends/sandbox/seatbelt";
import { sbplString } from "../../backends/sandbox/sbpl";
import { probeProcessBirth } from "../../custody/identity";
import { cleanOwnedProcessGroup } from "../../agent/process/process-group";
import { trackAuxiliaryProcessGroup } from "../../agent/process/agent-process-watchdog";
import { listenerIdentity, sameListener, type ListenerIdentity } from "./identity";
import type { FrozenPreviewFence } from "./fence";
export type ManagedPreview = { serverId: string; chatId: string; incarnationId: string; port: number; mode: "dev" | "build";
  state: "starting" | "running" | "stopped"; startedAt: number; };
type Entry = ManagedPreview & { fence: FrozenPreviewFence; identity: ListenerIdentity | null; close(reason?: "listener-changed"): Promise<void> };
export class PreviewServerSupervisor {
  private entries = new Map<string, Entry>();
  private stopped = false;
  private starting = 0;
  private readonly launches = new Map<Promise<ManagedPreview>, string>();
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(private readonly current: (chatId: string, incarnationId: string, workspace: string) => string | boolean,
    private readonly onStop: (serverId: string, reason?: "listener-changed") => Promise<void>) {
    this.timer = setInterval(() => { for (const entry of this.entries.values()) if (!this.valid(entry.chatId, entry.incarnationId, entry.fence)) void entry.close().catch(() => undefined); }, 1000);
    this.timer.unref();
  }
  bindAuthority(chatId: string, incarnationId: string, fence: FrozenPreviewFence | undefined) {
    if (!fence) return undefined;
    const identity = this.current(chatId, incarnationId, fence.workspace);
    return identity ? Object.freeze({ ...fence, authorityIdentity: String(identity) }) : undefined;
  }
  private valid(chatId: string, incarnationId: string, fence: FrozenPreviewFence) {
    const identity = this.current(chatId, incarnationId, fence.workspace);
    return !!identity && (!fence.authorityIdentity || fence.authorityIdentity === String(identity));
  }
  list(chatId?: string): ManagedPreview[] { return [...this.entries.values()].filter(e => !chatId || e.chatId === chatId).map(({ serverId, chatId, incarnationId, port, mode, state, startedAt }) => ({ serverId, chatId, incarnationId, port, mode, state, startedAt })); }
  async start(input: { serverId?: string; chatId: string; incarnationId: string; argv: string[]; cwd: string; port: number; mode: "dev" | "build"; fence: FrozenPreviewFence; signal: AbortSignal }) {
    if (this.stopped || process.platform !== "darwin" || process.arch !== "arm64") throw new Error("tunnel-platform-unsupported");
    if (this.entries.size + this.starting >= 8) throw new Error("preview-service-limit");
    this.starting++;
    let reserved = true;
    const release = () => { if (reserved) { reserved = false; this.starting--; } };
    const task = this.launch(input, release).finally(() => { release(); this.launches.delete(task); });
    this.launches.set(task, input.chatId); return task;
  }
  private async launch(input: { serverId?: string; chatId: string; incarnationId: string; argv: string[]; cwd: string; port: number; mode: "dev" | "build"; fence: FrozenPreviewFence; signal: AbortSignal }, release: () => void) {
    if (!this.valid(input.chatId, input.incarnationId, input.fence)) throw new Error("preview-chat-changed");
    input.signal.throwIfAborted();
    const workspace = await realpath(input.fence.workspace), cwd = await realpath(join(workspace, input.cwd));
    const tail = relative(workspace, cwd);
    if (isAbsolute(input.cwd) || tail === ".." || tail.startsWith("../")) throw new Error("preview-workspace-denied");
    const [program, ...args] = input.argv;
    if (!program) throw new Error("preview-command-invalid");
    let command: string | null = null;
    for (const path of isAbsolute(program) ? [program] : (input.fence.env.PATH ?? "/usr/bin:/bin").split(delimiter).filter(isAbsolute).map(root => join(root, program))) {
      try { await access(path, constants.X_OK); command = await realpath(path); break; } catch { /* Try the next explicit PATH entry. */ }
    }
    if (!command) throw new Error("preview-command-unavailable");
    const insideWorkspace = (path: string) => { const tail = relative(workspace, path); return tail !== ".." && !tail.startsWith("../") && !isAbsolute(tail); };
    const protectedRoots = [...input.fence.readOnlyRoots];
    // Preview never inherits Provider credentials. A stricter workspace fence also applies to full-access turns.
    const profile = buildSeatbeltProfile({ purpose: "subagent", cwd, sandboxRoot: workspace, readRoots: [],
      toolPolicy: "workspace", ephemeral: false, prompt: "", sandbox: "workspace-write", network: true, approvalPolicy: "never",
      env: "user-default", ignoreUserConfig: false, timeoutMs: 0 },
    { childEnv: input.fence.env, runtimeReadRoots: [dirname(command)], protectedReadOnlyRoots: protectedRoots.filter(insideWorkspace),
      deniedReadRoots: [input.fence.controlRoot, ...protectedRoots.filter(path => !insideWorkspace(path))] })
      + [...protectedRoots, input.fence.controlRoot].map(path => `(deny file-write* (subpath ${sbplString(path)}))\n`).join("");
    if (this.stopped || !this.valid(input.chatId, input.incarnationId, input.fence)) throw new Error("preview-chat-changed");
    const serverId = input.serverId ?? randomUUID();
    const child = spawn("/usr/bin/sandbox-exec", ["-p", profile, command, ...args], { cwd, env: { ...input.fence.env, PORT: String(input.port), HOST: "127.0.0.1" }, detached: true, stdio: "ignore" });
    let untrack = () => {}, closing: Promise<void> | null = null, rootBirth = "";
    const exited = new Promise<void>(resolve => { child.once("exit", () => { untrack(); resolve(); }); child.once("error", () => resolve()); });
    await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    const birth = probeProcessBirth(child.pid!);
    rootBirth = birth?.birthIdentity ?? "";
    const entry: Entry = { serverId, chatId: input.chatId, incarnationId: input.incarnationId, port: input.port, mode: input.mode,
      state: "starting", startedAt: Date.now(), fence: input.fence, identity: null,
      close: reason => closing ??= (async () => {
        entry.state = "stopped";
        const revoke = this.onStop(serverId, reason).then(() => null, error => error);
        const result = await cleanOwnedProcessGroup({ pid: child.pid!, birthIdentity: rootBirth || null });
        if (!result.ok) throw result.error;
        await exited; this.entries.delete(serverId); untrack(); const error = await revoke; if (error) throw error;
      })().catch(error => { closing = null; throw error; }) };
    this.entries.set(serverId, entry);
    release();
    void exited.then(() => { entry.state = "stopped"; void entry.close().catch(() => undefined); });
    try {
      if (!birth || birth.processGroupId !== child.pid) throw new Error("preview-process-unverified");
      untrack = trackAuxiliaryProcessGroup(child.pid, rootBirth, true);
      for (let i = 0; i < 120 && entry.state === "starting"; i++) {
        input.signal.throwIfAborted();
        if (this.stopped || !this.valid(input.chatId, input.incarnationId, input.fence)) throw new Error("preview-chat-changed");
        const identity = await listenerIdentity(child.pid!, rootBirth, input.port);
        if (identity) { entry.identity = identity; entry.state = "running"; return this.list(input.chatId).find(item => item.serverId === serverId)!; }
        await delay(500, undefined, { signal: input.signal });
      }
      throw new Error("preview-service-unavailable");
    } catch (error) { await entry.close(); throw error; }
  }
  async identity(serverId: string, chatId: string, incarnationId: string) {
    const entry = this.entries.get(serverId);
    if (!entry || entry.chatId !== chatId || entry.incarnationId !== incarnationId) throw new Error("preview-service-unavailable");
    if (entry.state !== "running" || !entry.identity || !this.valid(chatId, incarnationId, entry.fence)) {
      await entry.close(); throw new Error("preview-service-changed");
    }
    if (!await sameListener(entry.identity)) {
      const root = probeProcessBirth(entry.identity.rootPid);
      if (root?.birthIdentity === entry.identity.rootBirth && root.processGroupId === entry.identity.rootPid) {
        // Notify before cleanup, but do not hold the rejecting request behind its own proxy shutdown.
        void entry.close("listener-changed").catch(() => undefined);
      } else await entry.close();
      throw new Error("preview-service-changed");
    }
    return entry.identity;
  }
  async stop(serverId: string, chatId?: string, incarnationId?: string) {
    const entry = this.entries.get(serverId);
    if (entry && (!chatId || entry.chatId === chatId) && (!incarnationId || entry.incarnationId === incarnationId)) await entry.close();
  }
  async stopChats(chatIds: Iterable<string>) {
    const selected = new Set(chatIds);
    const closeEntries = () => Promise.allSettled([...this.entries.values()]
      .filter(entry => selected.has(entry.chatId)).map(entry => entry.close()));
    const results = await closeEntries();
    // A launch may still be awaiting filesystem or process identity before publishing its entry.
    await Promise.allSettled([...this.launches].filter(([, chatId]) => selected.has(chatId)).map(([task]) => task));
    results.push(...await closeEntries());
    const errors = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
    if (errors.length) throw new AggregateError(errors, "preview-stop-failed");
  }
  async close() { this.stopped = true; clearInterval(this.timer); const results = await Promise.allSettled([...this.entries.values()].map(entry => entry.close()));
    await Promise.allSettled(this.launches.keys());
    const errors = results.flatMap(r => r.status === "rejected" ? [r.reason] : []); if (errors.length) throw new AggregateError(errors, "preview-stop-failed"); }
}
