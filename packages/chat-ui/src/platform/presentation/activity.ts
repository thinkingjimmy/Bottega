/**
 * [INPUT]: Confirmed head activity identities, an account/device storage namespace, optional bounded persistence and an optional identity digest.
 * [OUTPUT]: Exact-turn unread consumption and reactive activity projection for browser hosts; a host that persists keeps digests, never Chat identities.
 * [POS]: Shared presentation library; terminal history is never execution authority.
 */
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
export type ActivityPersistence = { read(): unknown; write(value: string[]): void };
export function activityIdentity(head: CloudChatHead): string | null {
  const turn = head.activityTurn;
  return turn?.terminal ? JSON.stringify([head.chat.id, head.chat.incarnationId, turn.turnId, turn.executorDeviceId, turn.executionEpoch, turn.sequence]) : null;
}
export class ChatActivityStore {
  private readonly consumed = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private readonly digests = new Map<string, string>();
  private version = 0;
  /** `hash` makes the stored key opaque: a host that writes to shared storage passes one so no Chat, turn or device id is ever persisted in the clear. */
  constructor(private readonly persistence?: ActivityPersistence, private readonly hash?: (identity: string) => string) {
    try { const value = persistence?.read(); if (Array.isArray(value)) for (const key of value.slice(-500)) if (typeof key === "string" && key.length < 1024) this.consumed.add(key); } catch { /* Storage is optional. */ }
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.version;
  /* One digest per identity: the sidebar projects every row on each publish. */
  private key(head: CloudChatHead) {
    const identity = activityIdentity(head); if (identity === null || !this.hash) return identity;
    let digest = this.digests.get(identity);
    if (digest === undefined) { digest = this.hash(identity); if (this.digests.size >= 1_000) this.digests.clear(); this.digests.set(identity, digest); }
    return digest;
  }
  activity(head: CloudChatHead): NonNullable<CloudChatHead["activity"]> {
    const activity = head.activity ?? (head.openTurnId ? "unknown" : "idle"), key = this.key(head);
    return key && this.consumed.has(key) ? "idle" : activity;
  }
  consume(head: CloudChatHead) {
    const key = this.key(head); if (!key || this.consumed.has(key)) return;
    this.consumed.add(key);
    while (this.consumed.size > 500) this.consumed.delete(this.consumed.values().next().value!);
    try { this.persistence?.write([...this.consumed]); } catch { /* Memory still records the exact visible result. */ }
    this.version++; this.listeners.forEach(listener => listener());
  }
}
