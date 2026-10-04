/**
 * [INPUT]: Host-captured draft/plugin identity and strict bounded source/image chunks.
 * [OUTPUT]: PluginAttachmentHost with idempotent commit receipts and all-or-nothing integrity-checked attachment/source publication.
 * [POS]: Shared desktop/Web transaction owner; untrusted callers never select a Chat or write stores.
 */
import { PLUGIN_CHUNK_BYTES, type PluginSource } from '@bottega/contracts/plugins/surface/source';
import { PLUGIN_TRANSFER_TTL_MS } from '@bottega/contracts/plugins/surface/contract';
import { pluginTransferBeginSchema, pluginTransferChunkSchema, pluginTransferEndSchema, type PluginTransferBegin, type PluginTransferResult } from '@bottega/contracts/plugins/surface/transfer';
import { digestPluginBytes, fromBase64, toBase64 } from './codec';
type Part = { bytes: Uint8Array; offset: number; sha256: string };
type Pending = { input: PluginTransferBegin; image?: Part; source: Part; expires: number; committing: boolean };
export type PluginAttachmentPort = {
  pluginId: string; generationId: string; valid(): boolean;
  /** Synchronous final publication revalidates the captured draft and replacement ownership. */
  commit(input: { image: File; source: PluginSource; replaceAttachmentId?: string }): string;
  saveSource?(source: PluginSource, kind: 'checkpoint' | 'compute'): string | Promise<string>;
};
export class PluginAttachmentHost {
  private pending = new Map<string, Pending>();
  private closed = false;
  private completed = new Map<string, { result: PluginTransferResult; expires: number }>();
  private commits = new Map<string, Promise<PluginTransferResult>>();
  constructor(private readonly port: PluginAttachmentPort) {}
  private assert() { if (this.closed || !this.port.valid()) throw new Error('PLUGIN_OWNER_EXPIRED'); }
  private get(id: string) {
    this.assert(); const item = this.pending.get(id);
    if (!item || item.expires < Date.now()) { this.pending.delete(id); throw new Error('PLUGIN_TRANSFER_EXPIRED'); }
    return item;
  }
  begin(input: unknown) {
    this.assert();
    for (const [id, item] of this.pending) if (item.expires < Date.now()) this.pending.delete(id);
    if (this.pending.size) throw new Error('PLUGIN_TRANSFER_ACTIVE');
    const parsed = pluginTransferBeginSchema.parse(input);
    if (parsed.source.pluginId !== this.port.pluginId || parsed.source.generationId !== this.port.generationId) throw new Error('PLUGIN_SOURCE_IDENTITY');
    const part = (value: { byteLength: number; sha256: string }): Part => ({ bytes: new Uint8Array(value.byteLength), offset: 0, sha256: value.sha256 });
    const transactionId = crypto.randomUUID();
    this.pending.set(transactionId, { input: parsed, source: part(parsed.source), image: parsed.image ? part(parsed.image) : undefined,
      expires: Date.now() + PLUGIN_TRANSFER_TTL_MS, committing: false });
    return { transactionId };
  }
  chunk(input: unknown) {
    const chunk = pluginTransferChunkSchema.parse(input), item = this.get(chunk.transactionId), part = item[chunk.part];
    const bytes = fromBase64(chunk.bytes);
    if (item.committing || !part || chunk.offset !== part.offset || bytes.length > PLUGIN_CHUNK_BYTES || part.offset + bytes.length > part.bytes.length)
      throw new Error('PLUGIN_TRANSFER_CHUNK');
    part.bytes.set(bytes, part.offset); part.offset += bytes.length;
    return { receivedBytes: part.offset };
  }
  async commit(input: unknown): Promise<PluginTransferResult> {
    const { transactionId } = pluginTransferEndSchema.parse(input);
    this.assert();
    const receipt = this.completed.get(transactionId);
    if (receipt && receipt.expires >= Date.now()) return receipt.result;
    const pending = this.commits.get(transactionId);
    if (pending) return pending;
    const work = this.publish(transactionId).then(result => {
      if (!this.closed) {
        for (const [id, value] of this.completed) if (value.expires < Date.now()) this.completed.delete(id);
        if (this.completed.size >= 64) this.completed.delete(this.completed.keys().next().value!);
        this.completed.set(transactionId, { result: Object.freeze(result), expires: Date.now() + 5 * 60_000 });
      }
      return result;
    });
    this.commits.set(transactionId, work);
    try { return await work; } finally { this.commits.delete(transactionId); }
  }
  private async publish(transactionId: string): Promise<PluginTransferResult> {
    const item = this.get(transactionId);
    if (item.committing) throw new Error('PLUGIN_TRANSFER_ACTIVE');
    item.committing = true;
    try {
      for (const part of [item.source, item.image]) {
        if (part && (part.offset !== part.bytes.length || await digestPluginBytes(part.bytes) !== part.sha256)) throw new Error('PLUGIN_TRANSFER_INTEGRITY');
      }
      this.get(transactionId);
      const source: PluginSource = { ...item.input.source, encoding: 'base64', bytes: toBase64(item.source.bytes) };
      if (item.input.kind !== 'attachment') {
        if (!this.port.saveSource) throw new Error('PLUGIN_SOURCE_UNAVAILABLE');
        const sourceId = await this.port.saveSource(source, item.input.kind); this.assert(); return { sourceId };
      }
      const image = item.image!;
      const signature = [137,80,78,71,13,10,26,10];
      if (!signature.every((byte, index) => image.bytes[index] === byte)) throw new Error('PLUGIN_IMAGE_INVALID');
      const file = new File([image.bytes.slice().buffer], item.input.image!.name, { type: 'image/png' });
      this.assert();
      return { attachmentId: this.port.commit({ image: file, source, replaceAttachmentId: item.input.replaceAttachmentId }) };
    } finally { this.pending.delete(transactionId); }
  }
  abort(input: unknown) { const { transactionId } = pluginTransferEndSchema.parse(input); this.pending.delete(transactionId); }
  close() { this.closed = true; this.pending.clear(); this.completed.clear(); this.commits.clear(); }
}
