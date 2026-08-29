/**
 * [INPUT]: Depends on TurnRegistry activity truth and the Electron renderer event channel
 * [OUTPUT]: Provides deduplicated window-level running/waiting activity snapshots
 * [POS]: Agent bridge activity projection owner, independent from turn execution and IPC admission
 */

import type { BrowserWindow } from "electron";
import {
  AGENT_CHANNEL,
  type ChatActivityEvent,
} from "../../../shared/agent-ipc";
import {
  awaitsUserResponse,
  blocksNewTurn,
  type RegistryTurn,
  type TurnRegistry,
} from "../turn-registry";

export class AgentActivityPublisher<TTurn extends RegistryTurn> {
  private readonly running = new Map<string, boolean>();
  private window: BrowserWindow | null = null;

  constructor(private readonly turns: TurnRegistry<TTurn>) {}

  bind(window: BrowserWindow) {
    this.window = window;
  }

  list() {
    return [...this.running].map(([conversationId, waiting]) => ({
      conversationId,
      waiting,
    }));
  }

  forget(conversationId: string) {
    this.running.delete(conversationId);
  }

  publish(conversationId: string) {
    const entry = this.turns.byConversation(conversationId);
    const running = blocksNewTurn(entry);
    const waiting = running && awaitsUserResponse(entry);
    const next = running ? waiting : undefined;
    if (next === this.running.get(conversationId)) return;
    if (next === undefined) this.running.delete(conversationId);
    else this.running.set(conversationId, next);
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    try {
      window.webContents.send(AGENT_CHANNEL.activity, {
        conversationId,
        running,
        waiting,
        ...(entry?.effectiveTerminal
          ? { terminal: entry.effectiveTerminal.type }
          : {}),
      } satisfies ChatActivityEvent);
    } catch (cause) {
      console.warn("[agent] activity publish failed", cause);
    }
  }
}
