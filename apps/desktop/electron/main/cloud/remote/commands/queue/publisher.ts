/**
 * [INPUT]: Durable coordinator changes, confirmed local execution heads and the active account connection.
 * [OUTPUT]: Publishes content-free accepted queue heads, including the transition to empty, and ignores ledger mutations that leave the queue unchanged.
 * [POS]: Background queue adapter independent of renderer lifetime and command intake retries.
 */
import { protocolHeader, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import type { RelayLedger } from "../../../../sections/coordinator/relay-ledger";
import type { ChatStore } from "../../../../chats/chat-store";
import type { CloudTransport } from "../../../runtime/transport";
import type { RemoteCipherPort } from "@ai-chat/cloud-protocol/remote/encrypted/client";
import { canonicalHash } from "../../../../sections/coordinator/coordinator-values";
import type { RemoteConnection } from "../intake";
export class RemoteQueuePublisher {
  private readonly published = new Map<string, string>();
  private identity = "";
  private closed = false;
  private pending = false;
  private observed: string | null = null;
  private flight: Promise<void> | null = null;
  private readonly stop: () => void;
  constructor(private readonly ports: { ledger: RelayLedger; store: ChatStore; transport: CloudTransport; config: CloudBuildConfig;
    deviceId: string; connection(): RemoteConnection | null; crypto(): RemoteCipherPort }) {
    // Most ledger mutations leave the manual queue untouched; rescanning them would cost a Chat read per chat.
    this.stop = ports.ledger.onActionsChanged(() => { if (this.signature() !== this.observed) this.wake(); });
  }
  /** Cheap fingerprint of everything queuedProjection can observe, across chats. */
  private signature() {
    return canonicalHash(this.ports.ledger.read(state => Object.values(state.manualIntents)
      .map(intent => [intent.conversationId, intent.id, intent.sequence, intent.phase, intent.attempts.map(attempt => attempt.phase)])
      .sort((left, right) => String(left[1]).localeCompare(String(right[1])))));
  }
  wake() {
    if (this.closed) return;
    this.pending = true;
    if (!this.flight) this.flight = this.scan().catch(() => {}).finally(() => {
      this.flight = null; if (this.pending && !this.closed) this.wake();
    });
  }
  private async scan() {
    this.pending = false;
    const signature = this.signature(); this.observed = null;
    const connection = this.ports.connection(), identity = JSON.stringify(connection);
    if (identity !== this.identity) { this.published.clear(); this.identity = identity; }
    if (!connection?.enabled) return;
    const current = () => { if (this.closed || JSON.stringify(this.ports.connection()) !== identity) throw new Error("connection-changed"); };
    const ids = new Set(this.ports.ledger.read(state => Object.values(state.manualIntents)
      .map(intent => intent.conversationId)));
    for (const id of this.published.keys()) ids.add(id);
    for (const chatId of ids) {
      current(); const value = this.ports.ledger.remote.queue(chatId);
      const row = await this.ports.store.sync.read(connection.scope, { type: "remote-admission", chatId }); current();
      const head = row.type === "remote-admission" ? row.value?.execution?.head : null;
      if (!head || head.ownerDeviceId !== this.ports.deviceId) { this.published.delete(chatId); continue; }
      const stamp = `${head.chat.incarnationId}/${value.revision}`;
      if (this.published.get(chatId) === stamp) continue;
      const crypto = this.ports.crypto();
      await this.ports.transport.mutate("remote/queue:publish", { ...protocolHeader(this.ports.config), expectedUserId: connection.scope.userId,
        encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint }, connectionEpoch: connection.connectionEpoch,
        chatId, incarnationId: head.chat.incarnationId, queue: { ...value, deviceId: this.ports.deviceId } }); current();
      this.published.set(chatId, stamp);
    }
    this.observed = signature;
  }
  async close() { this.closed = true; this.stop(); await this.flight; this.published.clear(); }
}
