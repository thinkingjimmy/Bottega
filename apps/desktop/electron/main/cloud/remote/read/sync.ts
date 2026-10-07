/**
 * [INPUT]: Confirmed account-scoped Chat heads, native read receipts and the admitted read mutation port.
 * [OUTPUT]: Bidirectional exact-turn read synchronization with bounded retry and account replacement fences.
 * [POS]: Cloud navigation adapter; native presentation remains the authority for a local read.
 */
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
export type ReadActivityPort = {
  onConsumed(listener: () => void): () => void;
  hasConsumed(chatId: string, incarnationId: string, requestId: string): boolean;
  consumeCloud(chatId: string, incarnationId: string, requestId: string): void;
};
export class ChatReadSync {
  private readonly heads = new Map<string, CloudChatHead>();
  private readonly sent = new Set<string>();
  private readonly flights = new Set<string>();
  private identity: string | null = null;
  private closed = false;
  private readonly stop: () => void;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly ports: { activity: ReadActivityPort; scope(): string | null; send(head: CloudChatHead): Promise<boolean> }) {
    this.stop = ports.activity.onConsumed(() => this.wake());
  }
  private current() {
    const identity = this.ports.scope();
    if (identity !== this.identity) {
      this.identity = identity; this.heads.clear(); this.sent.clear(); this.flights.clear();
      clearTimeout(this.timer); this.timer = undefined;
    }
    return !this.closed && identity !== null;
  }
  observe(head: CloudChatHead) {
    if (!this.current()) return;
    this.heads.delete(head.chat.id); this.heads.set(head.chat.id, head);
    while (this.heads.size > 1_000) this.heads.delete(this.heads.keys().next().value!);
    const turn = head.activityTurn;
    if (turn?.terminal && head.activity === "idle") this.ports.activity.consumeCloud(head.chat.id, head.chat.incarnationId, turn.turnId);
    this.flush(head);
  }
  wake() {
    if (!this.current()) return;
    for (const head of this.heads.values()) this.flush(head);
  }
  private flush(head: CloudChatHead) {
    const turn = head.activityTurn;
    if (!turn?.terminal || head.activity === "idle" || !this.ports.activity.hasConsumed(head.chat.id, head.chat.incarnationId, turn.turnId)) return;
    const identity = this.identity, key = JSON.stringify([identity, head.chat.id, head.chat.incarnationId, turn.turnId, turn.sequence]);
    if (this.flights.has(key) || this.sent.has(key)) return;
    this.flights.add(key);
    void this.ports.send(head).then(() => {
      if (!this.closed && this.ports.scope() === identity) {
        this.sent.add(key);
        while (this.sent.size > 1_000) this.sent.delete(this.sent.values().next().value!);
      }
    }).catch(() => {}).finally(() => {
      this.flights.delete(key);
      if (!this.closed && this.ports.scope() === identity && !this.sent.has(key) && !this.timer) {
        this.timer = setTimeout(() => { this.timer = undefined; this.wake(); }, 5_000); this.timer.unref?.();
      }
    });
  }
  async close() { this.closed = true; this.stop(); clearTimeout(this.timer); this.heads.clear(); this.sent.clear(); }
}
