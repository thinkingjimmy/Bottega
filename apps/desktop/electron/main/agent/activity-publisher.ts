/**
 * [INPUT]: Depends on TurnRegistry identities, distinct approval/input states, terminal receipts, and trusted product-window broadcasts.
 * [OUTPUT]: Provides agentActivityPublisher snapshots, semantic change subscriptions, and retained unread identity validation/consumption.
 * [POS]: Shared main-process activity publisher used by Chat activity and presence projections.
 */

import type { BrowserWindow } from "electron";
import { AGENT_CHANNEL, type ChatActivityEvent } from "../../../shared/agent-ipc";
import type { PresentedChat, PresenceTask } from "../../../shared/presence-ipc";
import { awaitsUserResponse, blocksNewTurn, type RegistryTurn, type TurnRegistry } from "../turn-registry";
import { windowRegistry } from "../window/surfaces/window-registry";

export class AgentActivityPublisher<TTurn extends RegistryTurn> {
  private readonly events = new Map<string, ChatActivityEvent>();
  private readonly signatures = new Map<string, string>();
  private readonly listeners = new Set<() => void>();
  private readonly remote = new Map<string, { event: ChatActivityEvent; task: PresenceTask; signature: string }>();
  private window: BrowserWindow | null = null;
  constructor(private readonly turns: TurnRegistry<TTurn>) {}
  bind(window: BrowserWindow) { this.window = window; }
  onChanged(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  list() { return [...this.events.values()].map((event) => ({ ...event })); }
  remoteTasks() { return [...this.remote.values()].map(value => value.task); }
  publishRemote(event: ChatActivityEvent, task: PresenceTask) {
    if (blocksNewTurn(this.turns.byConversation(event.conversationId))) return;
    const signature = JSON.stringify([event, task]);
    const previous = this.remote.get(event.conversationId);
    const sameResult = previous?.event.sourceId === event.sourceId && previous?.event.requestId === event.requestId && previous?.event.generation === event.generation && previous?.event.terminalSeq === event.terminalSeq && previous?.event.terminal === event.terminal;
    const consumed = sameResult && Boolean(event.terminal) && !this.events.has(event.conversationId);
    if (this.remote.get(event.conversationId)?.signature === signature) return;
    this.remote.set(event.conversationId, { event, task, signature });
    this.signatures.delete(event.conversationId);
    if (!consumed) this.events.set(event.conversationId, event);
    this.notify(); if (!consumed) this.broadcast(event);
  }
  forgetRemote(conversationId: string) {
    const previous = this.remote.get(conversationId); if (!previous) return;
    this.remote.delete(conversationId);
    if (this.events.get(conversationId) === previous.event) {
      this.events.delete(conversationId); this.broadcast({ conversationId, running: false, waiting: false });
    }
    this.notify();
  }
  consume(receipt: PresentedChat) {
    const event = this.events.get(receipt.chatId);
    if (!event?.terminal || event.running || event.incarnationId !== receipt.incarnationId || event.requestId !== receipt.requestId ||
        event.sourceId !== receipt.sourceId || event.generation !== receipt.generation || event.terminalSeq !== receipt.terminalSeq) return false;
    return this.events.delete(receipt.chatId);
  }
  forget(conversationId: string) { this.remote.delete(conversationId); this.events.delete(conversationId); this.signatures.delete(conversationId); this.notify(); }
  publish(conversationId: string) {
    const entry = this.turns.byConversation(conversationId);
    const running = blocksNewTurn(entry);
    if (!running && this.remote.has(conversationId)) return;
    const event: ChatActivityEvent = { conversationId, running, waiting: running && awaitsUserResponse(entry),
      ...(entry ? { incarnationId: entry.incarnationId, requestId: entry.requestId, generation: entry.generation,
        terminalSeq: entry.terminalSeq, ...(entry.effectiveTerminal ? { terminal: entry.effectiveTerminal.type } : {}) } : {}) };
    const signature = JSON.stringify([event, entry?.phase, entry?.cleanup, entry?.persist,
      entry?.approvals.size, entry?.userInputs.size, entry?.currentSubagents?.size]);
    if (signature === this.signatures.get(conversationId)) return;
    this.signatures.set(conversationId, signature);
    this.remote.delete(conversationId);
    this.events.set(conversationId, event);
    this.notify();
    this.broadcast(event);
  }
  private broadcast(event: ChatActivityEvent) {
    try {
      if (!windowRegistry.publish(AGENT_CHANNEL.activity, event) && this.window && !this.window.isDestroyed()) {
        this.window.webContents.send(AGENT_CHANNEL.activity, event);
      }
    } catch (cause) { console.warn("[agent] activity publish failed", cause); }
  }
  private notify() { for (const listener of this.listeners) { try { listener(); } catch (cause) { console.warn("[agent] activity observer failed", cause); } } }
}
