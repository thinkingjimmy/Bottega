/**
 * [INPUT]: Depends on immutable document metadata and backing ArrayBuffer identities.
 * [OUTPUT]: Provides canonical retained-byte accounting and explicit editor/cache limits.
 * [POS]: Common admission ledger for model history, workers, and composer sources.
 */
import type { SketchDocument, SketchElement } from "./document";
export const SOURCE_BYTES = 16 * 1024 ** 2;
export const HISTORY_BYTES = 64 * 1024 ** 2;
export const TEMP_BYTES = 32 * 1024 ** 2;
export const CACHE_BYTES = 256 * 1024 ** 2;
export const MAX_ELEMENTS = 1000;
export const MAX_STEPS = 100;
export const INT32_MAX = 0x7fffffff;
export const utf8Bytes = (s: string) => new TextEncoder().encode(s).byteLength;
export function assertBudget(bytes: number, limit = SOURCE_BYTES): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > limit)
    throw new Error("SKETCH_BUDGET");
}
export function assertIndex(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > INT32_MAX)
    throw new Error("SKETCH_BUDGET");
}
export class ByteLedger {
  bytes = 0;
  readonly buffers = new Set<ArrayBufferLike>();
  readonly objects = new Set<object>();
  buffer(view: ArrayBufferView) {
    if (!this.buffers.has(view.buffer)) {
      this.buffers.add(view.buffer);
      this.bytes += view.buffer.byteLength;
    }
  }
  element(e: SketchElement) {
    if (this.objects.has(e)) return;
    this.objects.add(e);
    this.bytes += 128 + utf8Bytes(e.id) + utf8Bytes(e.color);
    if (e.kind === "stroke") this.buffer(e.points);
    if (e.kind === "text") this.bytes += utf8Bytes(e.text);
    if (e.kind === "ink") {
      if (this.objects.has(e.coverage)) return;
      this.objects.add(e.coverage);
      this.bytes += 64 + e.coverage.blocks.length * 8;
      for (const block of e.coverage.blocks) {
        if (this.objects.has(block)) continue;
        this.objects.add(block);
        this.bytes += 64 + utf8Bytes(block.id);
        this.buffer(block.rowIndex);
        this.buffer(block.spans);
      }
    }
  }
  document(doc: SketchDocument) {
    if (this.objects.has(doc)) return;
    this.objects.add(doc);
    this.bytes += 128 + utf8Bytes(doc.id) + doc.elements.length * 8;
    for (const element of doc.elements) this.element(element);
  }
}
const documentCosts = new WeakMap<SketchDocument, number>();
export function sourceBytes(doc: SketchDocument): number {
  const cached = documentCosts.get(doc);
  if (cached !== undefined) return cached;
  const ledger = new ByteLedger();
  ledger.document(doc);
  documentCosts.set(doc, ledger.bytes);
  return ledger.bytes;
}
export function retainedBytes(documents: Iterable<SketchDocument>): number {
  const ledger = new ByteLedger();
  for (const doc of documents) ledger.document(doc);
  return ledger.bytes;
}
export function admitDocument(doc: SketchDocument) {
  if (doc.elements.length > MAX_ELEMENTS) throw new Error("SKETCH_BUDGET");
  assertBudget(sourceBytes(doc));
}
