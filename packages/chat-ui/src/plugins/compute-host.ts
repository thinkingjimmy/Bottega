/**
 * [INPUT]: Host-owned isolated Worker construction, source budgets and current plugin lease validity.
 * [OUTPUT]: PluginCoverageHost validates RPC input, bounds work and fences every asynchronous reply.
 * [POS]: Trusted computation boundary; Surface CSP continues to forbid plugin-created workers.
 */
import { z } from 'zod';
import type { WorkerPort } from '../sketch/worker/client';
import { sameStamp, type CoverageRequest } from '../sketch/worker/protocol';
import { createDocument, validateDocument, type SketchElement } from '../sketch/model/document';
import { admitDocument, SOURCE_BYTES, TEMP_BYTES } from '../sketch/model/budget';
import { validateSweep } from '../sketch/model/ink/erase';
import { decodePluginValue, encodePluginValue } from './codec';
const identity = z.string().min(1).max(256), count = z.number().int().nonnegative();
const requestSchema = z.object({ requestId: identity, owner: identity, incarnationId: identity, documentRevision: count,
  phase: z.enum(['preview', 'final']), sampleSequence: count,
  points: z.array(z.object({ x: z.number().finite().min(-1e9).max(1e9), y: z.number().finite().min(-1e9).max(1e9) }).strict()).min(1).max(65536),
  radius: z.number().positive().max(1600), targets: z.array(z.unknown()).max(1000), deletedIds: z.array(identity).max(1000),
  start: z.object({ sourceBytes: count.max(SOURCE_BYTES), elementCount: count.max(1000), renderBytes: count.max(TEMP_BYTES) }).strict().optional(),
}).strict();
export class PluginCoverageHost {
  private worker?: WorkerPort;
  private pending: { reject(error: Error): void; timer: ReturnType<typeof setTimeout> } | null = null;
  private closed = false;
  constructor(private readonly createWorker: () => WorkerPort, private readonly valid: () => boolean = () => true) {}
  async compute(bytes: Uint8Array): Promise<Uint8Array> {
    if (this.closed || !this.valid()) throw new Error('PLUGIN_OWNER_EXPIRED');
    if (this.pending) throw new Error('PLUGIN_COMPUTE_BUSY');
    const parsed = requestSchema.parse(decodePluginValue(bytes));
    const document = { ...createDocument(), elements: parsed.targets as SketchElement[] };
    validateDocument(document); admitDocument(document); validateSweep(parsed.points, parsed.radius);
    if (document.elements.some(element => element.kind === 'text')) throw new Error('PLUGIN_COMPUTE_INVALID');
    const request = parsed as CoverageRequest;
    this.worker ??= this.createWorker();
    const worker = this.worker;
    return new Promise((resolve, reject) => {
      const finish = (error?: Error, output?: Uint8Array) => {
        if (!this.pending) return;
        clearTimeout(this.pending.timer); this.pending = null;
        if (error) { worker.terminate(); this.worker = undefined; reject(error); } else resolve(output!);
      };
      const timer = setTimeout(() => finish(new Error('PLUGIN_COMPUTE_TIMEOUT')), 10_000);
      this.pending = { timer, reject: error => finish(error) };
      worker.onmessage = ({ data }) => {
        if (!this.valid() || this.closed) { finish(new Error('PLUGIN_OWNER_EXPIRED')); return; }
        if (!sameStamp(data, request) || data.sampleSequence !== request.sampleSequence || data.phase !== request.phase) { finish(new Error('SKETCH_STALE_RESULT')); return; }
        try { finish(undefined, encodePluginValue(data)); } catch (error) { finish(error instanceof Error ? error : new Error('PLUGIN_COMPUTE_INVALID')); }
      };
      worker.onerror = worker.onmessageerror = () => finish(new Error('SKETCH_WORKER_FAILED'));
      try { worker.postMessage(request); } catch (error) { finish(error instanceof Error ? error : new Error('SKETCH_WORKER_FAILED')); }
    });
  }
  close() {
    this.closed = true; this.pending?.reject(new Error('PLUGIN_OWNER_EXPIRED'));
    this.worker?.terminate(); this.worker = undefined;
  }
}
/** The module is host-only. The plugin-facing compute.ts adapter contains no Worker constructor. */
export const createHostCoverageWorker = () => new Worker(new URL('../sketch/worker/coverage.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerPort;
