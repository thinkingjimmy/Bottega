/**
 * [INPUT]: Host-captured current draft, active plugin generation, scoped source custody and recovery persistence.
 * [OUTPUT]: PluginComposerSession handles scoped RPCs, read-only heartbeats, settled recovery queues and idempotent nonblocking terminal completion without exposing Chat identifiers.
 * [POS]: Shared renderer authority for native/Web plugin frames; transport authenticates every envelope separately.
 */
import { z } from 'zod';
import { PLUGIN_COMPOSER_OPERATIONS, PLUGIN_COMPUTE_CONTRACT } from '@bottega/contracts/plugins/surface/contract';
import { pluginSourceReadSchema, pluginTransferBeginSchema } from '@bottega/contracts/plugins/surface/transfer';
import {pluginSourceEditable, type PluginSource} from '@bottega/contracts/plugins/surface/source';
import type { WorkerPort } from '../../sketch/worker/client';
import { PluginAttachmentHost } from '../attachment';
import { PluginCoverageHost, createHostCoverageWorker } from '../compute-host';
import { digestPluginBytes, makePluginSource, toBase64, verifyPluginSource } from '../codec';
import type { PluginEndReason, PluginRecoveryPort, PluginSourceFormat } from './contracts';
const empty = z.object({}).strict(), closeSchema = z.object({ saved: z.boolean().optional(), discarded: z.boolean().optional() }).strict();
const computeSchema = z.union([z.object({ contract: z.literal(PLUGIN_COMPUTE_CONTRACT), sourceId: z.string().uuid() }).strict(),
  z.object({ contract: z.literal(PLUGIN_COMPUTE_CONTRACT), cancel: z.literal(true) }).strict()]);
export type PluginComposerSessionInput = {
  pluginId: string; generationId: string; locale: string; format: PluginSourceFormat;
  source?: PluginSource | null; attachmentId?: string; recovery: PluginRecoveryPort;
  valid(): boolean; settings(): Promise<unknown>; dirty(value: boolean): void; closed(reason: PluginEndReason): void;
  commit(image: File, source: PluginSource, replaceAttachmentId?: string): string;
  createWorker?: () => WorkerPort;
};
export class PluginComposerSession {
  private readonly id = crypto.randomUUID();
  private readonly transfer: PluginAttachmentHost;
  private readonly sources = new Map<string, { source: PluginSource; bytes: Uint8Array; kind: 'initial' | 'recovery' | 'compute' | 'checkpoint' }>();
  private compute: PluginCoverageHost | null = null;
  private opening: Promise<Record<string, unknown>> | null = null;
  private writes: Promise<void> = Promise.resolve();
  private ended = false;
  private published = false;
  private endPromise: Promise<void> | null = null;
  private closeReason: PluginEndReason | null = null;
  constructor(private readonly input: PluginComposerSessionInput) {
    this.transfer = new PluginAttachmentHost({ pluginId: input.pluginId, generationId: input.generationId, valid: () => !this.ended && (this.published || input.valid()),
      commit: ({ image, source, replaceAttachmentId }) => {
        if (replaceAttachmentId !== input.attachmentId) throw new Error('PLUGIN_ATTACHMENT_CHANGED');
        const attachmentId = input.commit(image, source, replaceAttachmentId);
        this.published = true;
        return attachmentId;
      }, saveSource: async (source, kind) => {
        if (kind === 'checkpoint') {
          this.writes = this.writes.catch(() => {}).then(() => { this.assert(); return input.recovery.write(source); });
          await this.writes;
        }
        return this.retain(source, kind);
      } });
  }
  private assert() { if (this.ended || !this.input.valid()) throw new Error('PLUGIN_OWNER_EXPIRED'); }
  private async retain(source: PluginSource, kind: 'initial' | 'recovery' | 'compute' | 'checkpoint') {
    const bytes = await verifyPluginSource(source);
    this.assert();
    for (const [id, value] of this.sources) if (value.kind === kind && kind !== 'initial') this.sources.delete(id);
    const id = crypto.randomUUID(); this.sources.set(id, { source, bytes, kind }); return id;
  }
  async request(operation: string, payload: unknown, signal?: AbortSignal): Promise<unknown> {
    if (operation === 'plugin.close' && this.closeReason) { closeSchema.parse(payload); return {}; }
    if (this.published) {
      if (this.ended || (operation !== 'plugin.transfer.commit' && operation !== 'plugin.close')) throw new Error('PLUGIN_SESSION_PUBLISHED');
    } else this.assert();
    signal?.throwIfAborted();
    if (!(PLUGIN_COMPOSER_OPERATIONS as readonly string[]).includes(operation)) throw new Error('PLUGIN_OPERATION_DENIED');
    switch (operation) {
      case 'plugin.open': {
        empty.parse(payload);
        this.opening ??= (async () => {
          const sourceId = this.input.source ? await this.retain(this.input.source, 'initial') : undefined;
          const recovery = await this.input.recovery.read(); this.assert();
          const recoverySourceId = recovery?.pluginId === this.input.pluginId ? await this.retain(recovery, 'recovery') : undefined;
          const settings = await this.input.settings(); this.assert();
          return { sessionId: this.id, pluginId: this.input.pluginId, generationId: this.input.generationId, locale: this.input.locale,
            sourceFormat: this.input.format, sourceId, recoverySourceId, attachmentId: this.input.attachmentId, settings, recoveryIncompatible: Boolean(recovery && !pluginSourceEditable(recovery,{pluginId:this.input.pluginId,format:this.input.format})) };
        })(); return this.opening;
      }
      case 'plugin.heartbeat': empty.parse(payload); return {};
      case 'plugin.settings.read': empty.parse(payload); return this.input.settings();
      case 'plugin.dirty': { const { dirty } = z.object({ dirty: z.boolean() }).strict().parse(payload); this.input.dirty(dirty); return { dirty }; }
      case 'plugin.transfer.begin': {
        const value = pluginTransferBeginSchema.parse(payload), format = value.source.format;
        if (value.kind !== 'compute' && (format.id !== this.input.format.id || format.version !== this.input.format.version)) throw new Error('PLUGIN_SOURCE_FORMAT');
        return this.transfer.begin(value);
      }
      case 'plugin.transfer.chunk': return this.transfer.chunk(payload);
      case 'plugin.transfer.abort': this.transfer.abort(payload); return {};
      case 'plugin.transfer.commit': return this.transfer.commit(payload);
      case 'plugin.source.read': {
        const value = pluginSourceReadSchema.parse(payload), held = this.sources.get(value.sourceId);
        if (!held || value.offset > held.bytes.length) throw new Error('PLUGIN_SOURCE_MISSING');
        return { bytes: toBase64(held.bytes.subarray(value.offset, value.offset + value.length)), byteLength: held.bytes.length,
          sha256: held.source.sha256, offset: value.offset };
      }
      case 'plugin.compute.coverage': {
        const value = computeSchema.parse(payload);
        if ('cancel' in value) { this.compute?.close(); this.compute = null; return {}; }
        const held = this.sources.get(value.sourceId);
        if (!held || held.kind !== 'compute') throw new Error('PLUGIN_SOURCE_MISSING');
        this.sources.delete(value.sourceId);
        this.compute ??= new PluginCoverageHost(this.input.createWorker ?? createHostCoverageWorker, () => !this.ended && this.input.valid());
        const bytes = await this.compute.compute(held.bytes); this.assert(); signal?.throwIfAborted();
        const source = await makePluginSource({ pluginId: this.input.pluginId, generationId: this.input.generationId,
          format: { id: PLUGIN_COMPUTE_CONTRACT, version: 1 } }, bytes);
        const sourceId = await this.retain(source, 'compute'); return { sourceId, byteLength: bytes.length, sha256: await digestPluginBytes(bytes) };
      }
      case 'plugin.close': {
        const value = closeSchema.parse(payload); const reason = value.saved ? 'saved' : value.discarded ? 'discarded' : 'crash';
        this.closeReason = reason;
        void this.end(reason); this.input.closed(reason); return {};
      }
      default: throw new Error('PLUGIN_OPERATION_DENIED');
    }
  }
  end(reason: PluginEndReason): Promise<void> {
    if (this.endPromise) return this.endPromise;
    this.ended = true; this.transfer.close(); this.compute?.close(); this.compute = null;
    this.sources.clear();
    // remove establishes the in-memory terminal fence synchronously, then drains adapter writes in order.
    const cleanup = reason === 'saved' || reason === 'discarded' ? this.input.recovery.remove() : Promise.resolve();
    this.endPromise = Promise.allSettled([this.writes, cleanup]).then(results => {
      if (results[1]?.status === 'rejected') console.warn('[plugin-recovery] terminal cleanup failed', results[1].reason);
    }); return this.endPromise;
  }
}
