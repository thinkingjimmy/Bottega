/**
 * [INPUT]: Confirmed account-scoped catalog revisions and the existing native activity publisher.
 * [OUTPUT]: Projects remote running/waiting/results into native unread, tray and top-panel identities.
 * [POS]: Background catalog observer; no synthetic Agent process, execution authority or renderer lifetime.
 */
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { ChatActivityEvent } from "../../../../shared/agent-ipc";
import type { PresenceTask } from "../../../../shared/presence-ipc";
import type { SyncScope } from "../../../../shared/local-storage/contracts";
import type { ChatSyncStore } from "../sync/chats/sources";
export type RemoteActivityPort = { publishRemote(event: ChatActivityEvent, task: PresenceTask): void; forgetRemote(chatId: string): void };
export function remoteActivity(head: CloudChatHead): { event: ChatActivityEvent; task: PresenceTask } | null {
  const turn = head.activityTurn;
  if (!turn || head.archivedAt !== null || head.chat.classification.conversationKind !== "ordinary") return null;
  const terminal = turn.terminal === "done" ? "done" : turn.terminal === "cancelled" ? "cancelled" : turn.terminal ? "error" : undefined;
  const phase = terminal === "done" ? "completed" : terminal === "error" ? "failed" : terminal === "cancelled" ? "cancelled" :
    head.activity === "waiting" ? "approval" : head.activity === "saving" ? "finishing" : head.activity === "unknown" ? "recovery" : "running";
  const identity = { incarnationId: head.chat.incarnationId, requestId: turn.turnId, generation: 1 };
  return { event: { ...identity, conversationId: head.chat.id, running: !terminal, waiting: phase === "approval" || phase === "recovery",
    ...(terminal ? { terminal, terminalSeq: turn.sequence } : {}) },
    task: { ...identity, chatId: head.chat.id, backend: head.chat.agent, title: head.chat.title, context: null, startedAt: turn.startedAt, phase, subtaskCount: 0 } };
}
export class RemoteActivityObserver {
  private scopeKey = "";
  private cursor = 0;
  private generation = 0;
  private closed = false;
  private flight: Promise<void> | null = null;
  private pending = false;
  private readonly active = new Set<string>();
  private readonly seen = new Map<string, string>();
  constructor(private readonly ports: { store: Pick<ChatSyncStore, "read">; activity: RemoteActivityPort; deviceId: string;
    scope(): SyncScope | null; exists(chatId: string): boolean; now?(): number }) {}
  private clear() {
    for (const id of this.active) this.ports.activity.forgetRemote(id);
    this.active.clear(); this.seen.clear(); this.cursor = 0; this.generation++;
  }
  wake() {
    if (this.closed) return;
    const scope = this.ports.scope(), key = JSON.stringify(scope);
    if (key !== this.scopeKey) { this.clear(); this.scopeKey = key; }
    this.pending = true;
    if (!this.flight) this.flight = this.scan().catch(() => {}).finally(() => {
      this.flight = null; if (this.pending && !this.closed) this.wake();
    });
  }
  private async scan() {
    this.pending = false;
    const scope = this.ports.scope(), generation = this.generation; if (!scope) return;
    const current = () => !this.closed && generation === this.generation && JSON.stringify(this.ports.scope()) === this.scopeKey;
    let throughRevision: number | null = null;
    for (;;) {
      const page = await this.ports.store.read(scope, { type: "confirmed-catalog", afterRevision: this.cursor, throughRevision });
      if (!current() || page.type !== "confirmed-catalog") return;
      for (const head of page.value.items) {
        const id = head.chat.id, value = head.activityTurn?.ownerDeviceId !== this.ports.deviceId && this.ports.exists(id) ? remoteActivity(head) : null;
        if (!value) { this.ports.activity.forgetRemote(id); this.active.delete(id); continue; }
        const terminalKey = JSON.stringify([head.chat.incarnationId, value.event.requestId, value.event.generation]);
        const initialHistory = !this.seen.has(id) && value.event.terminal && (head.activityTurn?.settledAt ?? 0) < (this.ports.now?.() ?? Date.now()) - 5_000;
        const oldTerminal = value.event.terminal && this.seen.get(id) === terminalKey && !this.active.has(id);
        this.seen.set(id, terminalKey);
        if (initialHistory || oldTerminal) continue;
        value.event.sourceId = JSON.stringify([scope, head.activityTurn!.ownerDeviceId]);
        this.ports.activity.publishRemote(value.event, value.task); this.active.add(id);
      }
      this.cursor = page.value.cursor ?? page.value.revision;
      if (page.value.complete) break;
      throughRevision = page.value.revision;
    }
    for (const id of this.active) if (!this.ports.exists(id)) { this.ports.activity.forgetRemote(id); this.active.delete(id); this.seen.delete(id); }
  }
  async close() { this.closed = true; this.clear(); await this.flight; }
}
