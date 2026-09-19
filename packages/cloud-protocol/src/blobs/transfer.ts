/**
 * [INPUT]: Depends on closed file contracts, incremental SHA-256 and injected platform transport/byte ports.
 * [OUTPUT]: Provides bounded hashing, immutable response-loss recovery, paced verification polling and verified downloads.
 * [POS]: SDK-free transfer state machine; clients own authentication, persistence and final byte publication.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { canonicalJson } from "../encryption/encoding";
import { beginUploadSchema, blobPartSchema, blobReadPlanSchema, uploadStatusSchema,
  type BeginBlobUpload, type BlobReadPlan, type BlobUploadStatus } from "./functions";
import { partSizes, type BlobDescriptor } from "./index";
import type { FileCipherPort } from "./encrypted/model";
import { MAX_PART_BYTES } from "../config";
export type BlobSource = { bytes: number; mime: string; read(offset: number, bytes: number): Promise<Uint8Array<ArrayBuffer>> };
export type BlobSink<T> = { write(bytes: Uint8Array<ArrayBuffer>): Promise<void>; commit(blob: BlobDescriptor): Promise<T>; abort(): Promise<void> };
type Part = BeginBlobUpload["parts"][number];
export type BlobTransferPorts = {
  crypto(): FileCipherPort;
  begin(input: BeginBlobUpload, signal: AbortSignal): Promise<BlobUploadStatus>;
  status(uploadId: string, signal: AbortSignal): Promise<BlobUploadStatus>;
  finalize(uploadId: string, signal: AbortSignal): Promise<BlobUploadStatus>;
  cancel(uploadId: string): Promise<BlobUploadStatus>;
  readPlan(blobId: string, owner: BeginBlobUpload["owner"], signal: AbortSignal): Promise<BlobReadPlan>;
  sendPart(uploadId: string, part: Part, bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal): Promise<Part>;
  readPart(plan: BlobReadPlan, part: Part, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>>;
};
export type FileProgress = { phase: "hashing" | "uploading" | "verifying" | "downloading"; bytes: number; total: number };
export const hashBytes = (bytes: Uint8Array) => bytesToHex(sha256(bytes));
export async function hashBlobSource(source: BlobSource, signal: AbortSignal, progress: (value: FileProgress) => void = () => undefined,
  partByteLimit = MAX_PART_BYTES) {
  partSizes(source.bytes);
  if (!Number.isSafeInteger(partByteLimit) || partByteLimit < 1 || partByteLimit > MAX_PART_BYTES) throw new Error("invalid-part-limit");
  const hash = sha256.create(), parts: Part[] = []; let offset = 0;
  while (offset < source.bytes) {
    signal.throwIfAborted(); const size = Math.min(partByteLimit, source.bytes - offset);
    const bytes = await source.read(offset, size); signal.throwIfAborted();
    if (bytes.byteLength !== size) throw new Error("file-source-changed");
    hash.update(bytes); parts.push({ partIndex: parts.length, bytes: size, sha256: hashBytes(bytes) }); offset += size;
    progress({ phase: "hashing", bytes: offset, total: source.bytes });
  }
  signal.throwIfAborted(); return { sha256: bytesToHex(hash.digest()), parts };
}
function checkStatus(value: unknown, input: BeginBlobUpload) {
  const status = uploadStatusSchema.parse(value);
  if (status.uploadId !== input.uploadId || status.payloadHash !== hashBytes(new TextEncoder().encode(canonicalJson(input))) ||
    new Set(status.received.map(part => part.partIndex)).size !== status.received.length || status.received.some(part => {
    const expected = input.parts[part.partIndex]; return !expected || part.bytes !== expected.bytes || part.sha256 !== expected.sha256;
  })) throw new Error("upload-receipt-mismatch"); return status;
}
const VERIFY_DELAYS = [500, 750, 1_000, 1_500] as const;
const wait = (signal: AbortSignal, ms: number) => new Promise<void>((resolve, reject) => {
  signal.throwIfAborted();
  const abort = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
  signal.addEventListener("abort", abort, { once: true });
});
export class BlobTransfer {
  private controller = new AbortController();
  private active = new Set<Promise<unknown>>();
  constructor(protected readonly ports: BlobTransferPorts) {}
  open() { if (this.controller.signal.aborted) this.controller = new AbortController(); }
  protected task<T>(external: AbortSignal | undefined, run: (signal: AbortSignal) => Promise<T>) {
    const signal = external ? AbortSignal.any([external, this.controller.signal]) : this.controller.signal;
    const flight = run(signal); this.active.add(flight);
    void flight.finally(() => this.active.delete(flight)).catch(() => undefined); return flight;
  }
  upload(raw: BeginBlobUpload, source: BlobSource, progress: (value: FileProgress) => void = () => undefined, external?: AbortSignal) {
    return this.task(external, async signal => {
      const input = beginUploadSchema.parse(raw); signal.throwIfAborted();
      if (source.bytes !== input.descriptor.bytes || source.mime !== input.descriptor.mime) throw new Error("file-source-changed");
      let status: BlobUploadStatus;
      try { status = checkStatus(await this.ports.begin(input, signal), input); }
      catch (error) { signal.throwIfAborted(); try { status = checkStatus(await this.ports.status(input.uploadId, signal), input); } catch { throw error; } }
      signal.throwIfAborted(); let offset = 0;
      // Sequential parts bound memory and preserve one ordered progress stream.
      for (const part of input.parts) {
        if (status.state !== "uploading") break;
        if (!status.received.some(value => value.partIndex === part.partIndex)) {
          const bytes = await source.read(offset, part.bytes); signal.throwIfAborted();
          if (bytes.byteLength !== part.bytes || hashBytes(bytes) !== part.sha256) throw new Error("file-source-changed");
          try {
            const receipt = blobPartSchema.parse(await this.ports.sendPart(input.uploadId, part, bytes, signal));
            if (receipt.partIndex !== part.partIndex || receipt.sha256 !== part.sha256 || receipt.bytes !== part.bytes) throw new Error("upload-receipt-mismatch");
          } catch (error) {
            signal.throwIfAborted(); status = checkStatus(await this.ports.status(input.uploadId, signal), input);
            if (!status.received.some(value => value.partIndex === part.partIndex)) throw error;
          }
        }
        offset += part.bytes; signal.throwIfAborted(); progress({ phase: "uploading", bytes: offset, total: source.bytes });
      }
      if (status.state === "uploading") {
        try { status = checkStatus(await this.ports.finalize(input.uploadId, signal), input); }
        catch { signal.throwIfAborted(); status = checkStatus(await this.ports.status(input.uploadId, signal), input); }
      }
      const deadline = Date.now() + 45_000;
      for (let attempt = 0; status.state === "verifying"; attempt++) {
        signal.throwIfAborted(); progress({ phase: "verifying", bytes: source.bytes, total: source.bytes });
        if (Date.now() >= deadline) throw new Error("file-verifying");
        await wait(signal, VERIFY_DELAYS[Math.min(attempt, VERIFY_DELAYS.length - 1)]!);
        status = checkStatus(await this.ports.status(input.uploadId, signal), input);
      }
      signal.throwIfAborted();
      if (status.state !== "ready") throw new Error(status.reason ?? "file-not-ready");
      return { ...input.descriptor, blobId: status.blobId };
    });
  }
  read<T>(blobId: string, owner: BeginBlobUpload["owner"], sink: BlobSink<T>,
    progress: (value: FileProgress) => void = () => undefined, external?: AbortSignal) {
    return this.task(external, async signal => {
      try {
        signal.throwIfAborted(); const plan = blobReadPlanSchema.parse(await this.ports.readPlan(blobId, owner, signal)); signal.throwIfAborted();
        if (plan.descriptor.blobId !== blobId || plan.owner.kind !== owner.kind || plan.owner.id !== owner.id ||
          plan.descriptor.encryption.chunkCount !== plan.parts.length || plan.parts.some((part, index) => part.partIndex !== index) ||
          plan.parts.reduce((sum, part) => sum + part.bytes, 0) !== plan.descriptor.bytes) throw new Error("invalid-file-read-plan");
        const hash = sha256.create(); let length = 0;
        for (const part of plan.parts) {
          signal.throwIfAborted(); const bytes = await this.ports.readPart(plan, part, signal); signal.throwIfAborted();
          if (bytes.byteLength !== part.bytes || hashBytes(bytes) !== part.sha256) throw new Error("file-integrity-mismatch");
          hash.update(bytes); await sink.write(bytes); length += bytes.byteLength;
          progress({ phase: "downloading", bytes: length, total: plan.descriptor.bytes });
        }
        if (length !== plan.descriptor.bytes || bytesToHex(hash.digest()) !== plan.descriptor.sha256) throw new Error("file-integrity-mismatch");
        signal.throwIfAborted(); return await sink.commit(plan.descriptor);
      } catch (error) { await sink.abort(); throw error; }
    });
  }
  cancel(uploadId: string) { return this.ports.cancel(uploadId); }
  async close() { this.controller.abort(new Error("file-transfer-closed")); await Promise.allSettled([...this.active]); }
}
