/**
 * [INPUT]: Depends on TurnRegistry identities, distinct approval/input states, terminal receipts, and trusted product-window broadcasts.
 * [OUTPUT]: Provides agentActivityPublisher snapshots, semantic change subscriptions, and retained unread identity validation/consumption.
 * [POS]: Shared main-process activity publisher used by Chat activity and presence projections.
 */

import type { BrowserWindow } from "electron";
import { AGENT_CHANNEL, type ChatActivityEvent } from "../../../shared/agent-ipc";
import type { PresentedChat } from "../../../shared/presence-ipc";
import { awaitsUserResponse, blocksNewTurn, type RegistryTurn, type TurnRegistry } from "../turn-registry";
import { windowRegistry } from "../window/surfaces/window-registry";

export class AgentActivityPublisher<TTurn extends RegistryTurn> {
  private readonly events = new Map<string, ChatActivityEvent>();
  private readonly signatures = new Map<string, string>();
  private readonly listeners = new Set<() => void>();
  private window: BrowserWindow | null = null;
  constructor(private readonly turns: TurnRegistry<TTurn>) {}
  bind(window: BrowserWindow) { this.window = window; }
  onChanged(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  list() { return [...this.events.values()].map((event) => ({ ...event })); }
  consume(receipt: PresentedChat) {
    const event = this.events.get(receipt.chatId);
    if (!event?.terminal || event.running || event.incarnationId !== receipt.incarnationId || event.requestId !== receipt.requestId ||
        event.generation !== receipt.generation || event.terminalSeq !== receipt.terminalSeq) return false;
    return this.events.delete(receipt.chatId);
  }
  forget(conversationId: string) { this.events.delete(conversationId); this.signatures.delete(conversationId); this.notify(); }
  publish(conversationId: string) {
    const entry = this.turns.byConversation(conversationId);
    const running = blocksNewTurn(entry);
    const event: ChatActivityEvent = { conversationId, running, waiting: running && awaitsUserResponse(entry),
      ...(entry ? { incarnationId: entry.incarnationId, requestId: entry.requestId, generation: entry.generation,
        terminalSeq: entry.terminalSeq, ...(entry.effectiveTerminal ? { terminal: entry.effectiveTerminal.type } : {}) } : {}) };
    const signature = JSON.stringify([event, entry?.phase, entry?.cleanup, entry?.persist,
      entry?.approvals.size, entry?.userInputs.size, entry?.currentSubagents?.size]);
    if (signature === this.signatures.get(conversationId)) return;
    this.signatures.set(conversationId, signature);
    this.events.set(conversationId, event);
    this.notify();
    try {
      if (!windowRegistry.publish(AGENT_CHANNEL.activity, event) && this.window && !this.window.isDestroyed()) {
        this.window.webContents.send(AGENT_CHANNEL.activity, event);
      }
    } catch (cause) { console.warn("[agent] activity publish failed", cause); }
  }
  private notify() { for (const listener of this.listeners) { try { listener(); } catch (cause) { console.warn("[agent] activity observer failed", cause); } } }
}
