/**
 * [INPUT]: Uses exact Chat/incarnation/request identities, original command item identity, frozen mode, durable result commits and custody-owned termination/release callbacks.
 * [OUTPUT]: Exports nativeBackgrounds, NativeBackgroundRegistry, BackgroundEntry and native terminal snapshots.
 * [POS]: Main-owned post-turn execution registry; retains no model or MCP authority and never signals a bare PID.
 */
import { createAgentCleanupGuard } from "../../../../agent-process-supervisor";
import type { AgentPermissionMode } from "../../../../../../shared/ipc/agent/agent-ipc";
import type { NativeBackgroundCommand, NativeBackgroundResult } from "../../../../../../shared/ipc/agent/background-ipc";
export type NativeTerminal = { processId: string; itemId: string; command: string; cwd: string };
type Owner = { key: string; requestId: string; providerId: string; chatId: string; incarnationId: string; threadId: string; lastTurnId: string; permissionMode: AgentPermissionMode;
  terminals: NativeTerminal[]; persist(results: NativeBackgroundResult[]): Promise<void>; stopNative(): Promise<void>; settle(): Promise<"released" | "unconfirmed">; forget(): void };
export type BackgroundEntry = Owner & { guard: ReturnType<typeof createAgentCleanupGuard>; active: boolean; status: NativeBackgroundCommand["status"]; output: Map<string, string>; results: Map<string, NativeBackgroundResult>; persisted: Set<string>; pending: Promise<void>; release?: () => Promise<void>; stopping?: Promise<void> };

export class NativeBackgroundRegistry {
  private readonly entries = new Map<string, BackgroundEntry>();
  private projection?: typeof import("./output");
  private readonly listeners = new Set<(chatId: string) => void>();
  private readonly notifications = new Map<string, ReturnType<typeof setTimeout>>();
  onChanged(listener: (chatId: string) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed(chatId: string) {
    if (this.notifications.has(chatId)) return;
    this.notifications.set(chatId, setTimeout(() => { this.notifications.delete(chatId); for (const listener of this.listeners) listener(chatId); }, 120));
  }
  async stage(owner: Owner) {
    const projection = await import("./output");
    if (this.entries.has(owner.key) || this.entries.size >= 64 || [...this.entries.values()].filter(e => e.chatId === owner.chatId).length >= 8) throw new Error("Native background owner limit reached");
    if (!owner.terminals.length || owner.terminals.length > 64 || owner.terminals.some(t => !t.processId || t.processId.length > 4096 || t.command.length > 65_536 || t.cwd.length > 4096)) throw new Error("Invalid native background terminal snapshot");
    if (new Set(owner.terminals.map(row => row.itemId)).size !== owner.terminals.length || new Set(owner.terminals.map(row => row.processId)).size !== owner.terminals.length) throw new Error("Duplicate native background identity");
    this.projection = projection;
    this.entries.set(owner.key, { ...owner, guard: createAgentCleanupGuard(owner.providerId), terminals: structuredClone(owner.terminals), active: false, status: "running", output: new Map(), results: new Map(), persisted: new Set(), pending: Promise.resolve() });
  }
  activate(key: string, release: () => Promise<void>) {
    const entry = this.entries.get(key);
    if (!entry || entry.active) return false;
    entry.release = release; entry.active = true;
    this.changed(entry.chatId);
    return true;
  }
  continuation(chatId: string, incarnationId: string, threadId: string) {
    const entry = [...this.entries.values()].find(e => e.chatId === chatId && e.incarnationId === incarnationId && e.threadId === threadId);
    return entry ? { threadId: entry.threadId, lastTurnId: entry.lastTurnId } : null;
  }
  list(chatId: string): NativeBackgroundCommand[] {
    return this.projection?.listCommands(this.entries.values(), chatId) ?? [];
  }
  update(key: string, terminals: NativeTerminal[], output?: { itemId: string; delta: string }) {
    const entry = this.entries.get(key); if (!entry) return;
    if (terminals.length > 64 || terminals.some(t => !entry.terminals.some(old => old.processId === t.processId))) throw new Error("Background owner cannot add new executions");
    const changed = terminals.length && JSON.stringify(entry.terminals) !== JSON.stringify(terminals);
    if (!changed && !output) return;
    if (output) this.projection!.appendOutput(entry, output);
    if (entry.active) this.changed(entry.chatId);
  }
  complete(key: string, result: NativeBackgroundResult) {
    const entry = this.entries.get(key);
    if (!entry || !entry.terminals.some(row => row.itemId === result.itemId)) return Promise.reject(new Error("Native result has no retained owner"));
    if (!["completed", "failed"].includes(result.outcome) || !Number.isSafeInteger(result.exitCode) || Math.abs(result.exitCode!) > 2 ** 31 ||
      (result.outcome === "completed" && result.exitCode !== 0) || typeof result.output !== "string" || Buffer.byteLength(result.output) > 65_536) return Promise.reject(new Error("Invalid native command result"));
    const commit = entry.pending.then(async () => {
      if (entry.results.has(result.itemId)) return;
      const output = result.output || entry.output.get(result.itemId) || "";
      entry.results.set(result.itemId, { ...result, output });
      await entry.persist([{ ...result, itemId: this.projection!.commandItemId(entry.requestId, result.itemId), output }]);
      entry.persisted.add(result.itemId); this.changed(entry.chatId);
    });
    entry.pending = commit.catch(() => undefined);
    return commit;
  }
  async stopCommand(chatId: string, incarnationId: string, id: string) {
    const key = id, entry = this.entries.get(key);
    if (!entry || !entry.active || entry.chatId !== chatId || entry.incarnationId !== incarnationId) throw new Error("Native background command expired or belongs to another Chat");
    // One retained App Server owns this terminal group. Stop it as one custody unit.
    await this.stop(key);
  }
  async stop(key: string, reason: "stopped" | "unknown" = "stopped") {
    const entry = this.entries.get(key); if (!entry) return;
    if (entry.stopping) return entry.stopping;
    entry.status = "stopping";
    this.changed(entry.chatId);
    entry.stopping = (async () => {
      await entry.stopNative().catch(() => undefined);
      if (await entry.settle() !== "released") throw new Error("Native background process cleanup is unconfirmed");
      await entry.pending;
      const unresolved = entry.terminals.filter(row => !entry.persisted.has(row.itemId));
      if (unresolved.length) {
        await entry.persist(unresolved.map(row => ({ ...(entry.results.get(row.itemId) ?? { outcome: reason, output: entry.output.get(row.itemId) ?? "" }), itemId: this.projection!.commandItemId(entry.requestId, row.itemId) })));
        for (const row of unresolved) entry.persisted.add(row.itemId);
      }
      await entry.release?.();
      entry.forget(); this.entries.delete(key); entry.guard.released(); this.changed(entry.chatId);
    })().catch(cause => { entry.status = "failed"; entry.guard.fail(cause); this.changed(entry.chatId); throw cause; }).finally(() => { entry.stopping = undefined; });
    return entry.stopping;
  }
  private async stopEntries(entries: BackgroundEntry[]) {
    const results = await Promise.allSettled(entries.map(e => this.stop(e.key)));
    const failures = results.flatMap(r => r.status === "rejected" ? [r.reason] : []);
    if (failures.length) throw new AggregateError(failures, "Native background cleanup incomplete");
  }
  stopChat(chatId: string) { return this.stopEntries([...this.entries.values()].filter(e => e.chatId === chatId)); }
  stopProvider(providerId: string) { return this.stopEntries([...this.entries.values()].filter(e => e.providerId === providerId)); }
  stopAll() { return this.stopEntries([...this.entries.values()]); }
  discard(key: string) { const entry = this.entries.get(key); if (entry && !entry.active) this.entries.delete(key); }
}
export const nativeBackgrounds = new NativeBackgroundRegistry();
