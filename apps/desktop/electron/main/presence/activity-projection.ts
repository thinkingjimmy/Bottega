/**
 * [INPUT]: Depends on TurnRegistry state, synchronous coordinator identities, Agent activity, and ChatsService.onEvent.
 * [OUTPUT]: Provides bounded revisioned task snapshots, accurate phases/subtask counts, row expiry, and independent failure-prioritized batch results.
 * [POS]: Main task projection shared by tray and the independent top panel.
 */

import type { StopOperation } from "./lifecycle/start-fence";
import type { TaskActivitySnapshot, PresenceTask, TaskPhase } from "../../../shared/presence-ipc";
import { blocksNewTurn, type RegistryTurn, type TurnEntry, type TurnRegistry } from "../turn-registry";
import type { ChatsService } from "../chats/chats-service";
import type { AgentActivityPublisher } from "../agent/activity-publisher";

type TerminalPhase = Extract<TaskPhase, "completed" | "cancelled" | "failed">;
const finished = (phase: TaskPhase): phase is TerminalPhase => ["completed", "cancelled", "failed"].includes(phase);
export function taskPhase(entry: TurnEntry): TaskPhase {
  if (entry.phase === "resume-failed" || entry.cleanup === "failed" || ["retryable", "fatal"].includes(entry.persist)) return "recovery";
  if (entry.approvals.size) return "approval";
  if (entry.userInputs.size) return "answer";
  if (entry.effectiveTerminal) {
    if (blocksNewTurn(entry)) return "finishing";
    return entry.effectiveTerminal.type === "error" ? "failed" : entry.effectiveTerminal.type === "cancelled" ? "cancelled" : "completed";
  }
  if (entry.sourceTerminal) return "finishing";
  return entry.phase === "active" ? "running" : "preparing";
}

export class ActivityProjection<TTurn extends RegistryTurn> {
  private value: TaskActivitySnapshot = { version: 1, revision: 0, tasks: [], total: 0, running: 0, waiting: 0, overflow: 0, result: null };
  private readonly listeners = new Set<(value: TaskActivitySnapshot) => void>();
  private readonly stop: Array<() => void>;
  private readonly terminalAt = new Map<string, number>();
  private batchActive = false;
  private batchResult: TaskActivitySnapshot["result"] = null;
  private resultUntil = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly ports: { turns: TurnRegistry<TTurn>; chats: ChatsService; activity: AgentActivityPublisher<TTurn>; now?: () => number; pending?(): readonly StopOperation[]; onPendingChanged?(listener: () => void): () => void }) {
    this.stop = [ports.activity.onChanged(() => this.refresh()), ports.chats.onEvent((event) => {
      if (event.type === "upserted" || event.type === "removed") this.refresh();
    })];
    if (ports.onPendingChanged) this.stop.push(ports.onPendingChanged(() => this.refresh()));
    this.refresh();
  }
  snapshot() { return this.value; }
  onChanged(listener: (value: TaskActivitySnapshot) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private refresh() {
    const now = this.ports.now?.() ?? Date.now();
    const tasks: PresenceTask[] = [];
    const newTerminals: TerminalPhase[] = [];
    const activeKeys = new Set<string>();
    let nextExpiry = Infinity;
    for (const entry of this.ports.turns.liveEntries()) {
      if (!entry.origin || !["manual", "relay"].includes(entry.origin.kind)) continue;
      const chat = this.ports.chats.store.getChatRef(entry.conversationId);
      if (!chat || (entry.incarnationId && chat.incarnationId !== entry.incarnationId)) continue;
      const phase = taskPhase(entry);
      const key = JSON.stringify([entry.conversationId, entry.incarnationId, entry.requestId, entry.generation]);
      activeKeys.add(key);
      if (finished(phase)) {
        if (!this.terminalAt.has(key)) newTerminals.push(phase);
        const at = this.terminalAt.get(key) ?? now;
        this.terminalAt.set(key, at);
        if (now >= at + 5_000) continue;
        nextExpiry = Math.min(nextExpiry, at + 5_000);
      } else this.terminalAt.delete(key);
      tasks.push({ chatId: chat.id, incarnationId: chat.incarnationId, requestId: entry.requestId,
        generation: entry.generation, backend: entry.backend, title: chat.title?.slice(0, 160) ?? null,
        context: null, startedAt: entry.startedAt || null, phase, subtaskCount: entry.currentSubagents?.size ?? 0 });
    }
    for (const pending of this.ports.pending?.() ?? []) {
      const existing = tasks.findIndex((task) => task.chatId === pending.conversationId);
      if (existing >= 0 && !finished(tasks[existing]!.phase)) continue;
      const chat = this.ports.chats.store.getChatRef(pending.conversationId);
      const incarnationId = pending.incarnationId ?? chat?.incarnationId;
      const backend = pending.backend ?? this.ports.chats.store.getMetadata(pending.conversationId)?.agent;
      if (!incarnationId || !backend || (chat && chat.incarnationId !== incarnationId)) continue;
      if (existing >= 0) tasks.splice(existing, 1);
      tasks.push({ chatId: pending.conversationId, incarnationId, requestId: pending.requestId ?? pending.operationId,
        generation: pending.generation, backend, title: chat?.title?.slice(0, 160) ?? null, context: null,
        startedAt: pending.startedAt ?? null, phase: "preparing", subtaskCount: 0 });
    }
    tasks.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0) || a.chatId.localeCompare(b.chatId));
    const live = tasks.filter((task) => !finished(task.phase));
    const waiting = live.filter((task) => ["approval", "answer", "recovery"].includes(task.phase)).length;
    const newBatch = !this.batchActive && (live.length > 0 || newTerminals.length > 0);
    if (newBatch) this.batchResult = null;
    // Row expiry must not erase an earlier outcome while the rest of the batch is still running.
    for (const phase of newTerminals) {
      this.batchResult = this.batchResult === "failed" || phase === "failed" ? "failed" :
        this.batchResult === null || this.batchResult === phase ? phase : "ended";
    }
    if (!live.length && (this.batchActive || newBatch)) this.resultUntil = now + 5_000;
    this.batchActive = live.length > 0;
    const result = !this.batchActive && now < this.resultUntil ? this.batchResult : null;
    if (result) nextExpiry = Math.min(nextExpiry, this.resultUntil);
    const next = { version: 1 as const, tasks: tasks.slice(0, 100), total: tasks.length, running: live.length - waiting,
      waiting, overflow: Math.max(0, tasks.length - 100), result };
    const { revision: _, ...previous } = this.value;
    if (JSON.stringify(next) !== JSON.stringify(previous)) {
      this.value = { ...next, revision: this.value.revision + 1 };
      for (const listener of this.listeners) listener(this.value);
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = Number.isFinite(nextExpiry) ? setTimeout(() => this.refresh(), Math.max(1, nextExpiry - now)) : null;
    this.timer?.unref?.();
    for (const key of this.terminalAt.keys()) if (!activeKeys.has(key)) this.terminalAt.delete(key);
  }
  close() { this.stop.forEach((stop) => stop()); if (this.timer) clearTimeout(this.timer); this.listeners.clear(); }
}
