/**
 * [INPUT]: Depends on the scoped BlobStore, bounded filesystem sources and immutable private descriptors.
 * [OUTPUT]: Provides expiring opaque file leases whose bytes are verified before renderer access.
 * [POS]: Main-only Chat file boundary; callers never choose a path or receive account credentials.
 */
import { randomUUID } from "node:crypto";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { BlobSource } from "@ai-chat/cloud-protocol";
import { encryptedFileDescriptorSchema, type EncryptedFileDescriptor } from "@ai-chat/cloud-protocol/blobs/encrypted";
import { DesktopBlobStore, localBlobSource } from "../files/store";
type File = Awaited<ReturnType<typeof localBlobSource>>;
export class ChatFileLeases {
  private readonly controller = new AbortController();
  private readonly leases = new Map<string, { file: File; touchedAt: number }>();
  private readonly active = new Set<Promise<unknown>>();
  private closing: Promise<void> | null = null;
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(private readonly files: DesktopBlobStore, private readonly current: () => void) {
    this.timer = setInterval(() => { for (const [id, lease] of this.leases) if (Date.now() - lease.touchedAt > 120_000) void this.release(id); }, 30_000);
    this.timer.unref();
  }
  open(chatId: string, descriptor: EncryptedFileDescriptor) {
    this.current(); this.controller.signal.throwIfAborted();
    if (this.active.size + this.leases.size >= 4) return Promise.reject(new Error("CHAT_FILE_BUSY"));
    const flight = this.prepare(chatId, encryptedFileDescriptorSchema.parse(descriptor)); this.active.add(flight);
    void flight.finally(() => this.active.delete(flight)).catch(() => {}); return flight;
  }
  openCaptured(capture: (signal: AbortSignal) => Promise<BlobSource>) {
    this.current(); this.controller.signal.throwIfAborted();
    if (this.active.size + this.leases.size >= 4) return Promise.reject(new Error("CHAT_FILE_BUSY"));
    const flight = (async () => {
      const source = await capture(this.controller.signal); this.current(); this.controller.signal.throwIfAborted();
      const leaseId = randomUUID(); this.leases.set(leaseId, { file: { source, close: async () => {} }, touchedAt: Date.now() }); return { leaseId };
    })();
    this.active.add(flight); void flight.finally(() => this.active.delete(flight)).catch(() => {}); return flight;
  }
  private async prepare(chatId: string, descriptor: EncryptedFileDescriptor) {
    const value = await this.files.read(descriptor, { kind: "chat", id: chatId }, this.controller.signal);
    this.current(); this.controller.signal.throwIfAborted();
    if (hashChatContent(value.descriptor) !== hashChatContent(descriptor)) throw new Error("CHAT_FILE_CHANGED");
    const file = await localBlobSource(value.path, descriptor.mime);
    try {
      this.current(); this.controller.signal.throwIfAborted();
      const leaseId = randomUUID(); this.leases.set(leaseId, { file, touchedAt: Date.now() }); return { leaseId };
    } catch (error) { await file.close(); throw error; }
  }
  async read(leaseId: string, offset: number, length: number) {
    this.current(); this.controller.signal.throwIfAborted(); const lease = this.leases.get(leaseId);
    if (!lease || Date.now() - lease.touchedAt > 120_000 || length > 1024 * 1024) throw new Error("CHAT_FILE_LEASE_EXPIRED");
    lease.touchedAt = Date.now(); const bytes = await lease.file.source.read(offset, length); this.current(); return bytes;
  }
  async release(leaseId: string) { const lease = this.leases.get(leaseId); this.leases.delete(leaseId); await lease?.file.close(); }
  close() {
    if (!this.closing) this.closing = this.dispose();
    return this.closing;
  }
  private async dispose() { clearInterval(this.timer); this.controller.abort(); await this.files.close(); await Promise.allSettled(this.active);
    await Promise.allSettled([...this.leases.keys()].map(id => this.release(id))); }
}
