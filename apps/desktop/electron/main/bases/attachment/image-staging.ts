/**
 * [INPUT]: Depends on private temporary files, SHA-256, closed image contracts and the owner attachment store.
 * [OUTPUT]: Provides bounded, renderer-incarnation-bound image staging and verified bytes for an atomic owner commit.
 * [POS]: Native image transfer queue; staging never creates rows and is disposable until BaseStore publishes references.
 */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { BASE_IMAGE_PART_BYTES, type ImageBegin, type ImagePart, type ImageTransferRequest,
  type ImageScope, type ImageStatus, type ImageErrorCode } from "@ai-chat/base-ui/attachments/native-images";
import { BASE_ATTACHMENT_QUEUE_BYTES, BASE_ATTACHMENT_JOB_LIMIT } from "../../../../shared/bases/gallery-attachments";
import type { BaseAttachmentValue } from "../../../../shared/bases-ipc";
import { SerialQueue } from "../../persistence/serial-queue";
import { ownerFileStem } from "../store/base-files";
import { describeVerifiedImage, type BaseAttachmentStore } from "../store/attachments";

export type ImageCaller = { webContentsId: number; rendererIncarnation: string };
type Job = { id: string; caller: ImageCaller; input: ImageBegin; path: string; offset: number; touchedAt: number;
  released: boolean; controller: AbortController; parts: Map<number, { bytes: number; sha256: string }>; value?: BaseAttachmentValue };
export type ReadyImage = { value: BaseAttachmentValue; persist(): Promise<BaseAttachmentValue> };
const TTL = 15 * 60_000;
export const imageError = (code: ImageErrorCode) => Object.assign(new Error(code), { code });

export class BaseImageStaging {
  private readonly queue = new SerialQueue();
  private readonly jobs = new Map<string, Job>();
  private readonly closedRenderers = new Set<number>();
  private reservedBytes = 0;
  private readonly directory: string;
  private readonly ready: Promise<void>;
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(private readonly attachments: BaseAttachmentStore,
    private readonly validateImage: (bytes: Buffer, value: BaseAttachmentValue, signal: AbortSignal) => Promise<void>, private readonly now = Date.now) {
    this.directory = join(attachments.root, "image-staging");
    this.ready = this.initialize();
    // Idle pages cannot indefinitely retain unfinished upload reservations.
    this.timer = setInterval(() => { void this.queue.enqueue(async () => { await this.ready; await this.expire(); }).catch(() => undefined); }, 60_000);
    this.timer.unref();
  }

  begin(caller: ImageCaller, input: ImageBegin): Promise<ImageStatus> {
    return this.run(caller, async () => {
      const existing = [...this.jobs.values()].find(job => sameCaller(job.caller, caller) && job.input.uploadId === input.uploadId);
      if (existing) {
        if (!isDeepStrictEqual(existing.input, input)) throw imageError("image_transfer_conflict");
        existing.touchedAt = this.now(); return status(existing);
      }
      if (this.jobs.size >= BASE_ATTACHMENT_JOB_LIMIT || this.reservedBytes + input.byteLength > BASE_ATTACHMENT_QUEUE_BYTES) throw imageError("image_upload_limit");
      const id = randomUUID(), path = join(this.directory, id + ".part");
      const file = await open(path, "wx", 0o600); await file.close();
      const job: Job = { id, caller: { ...caller }, input: structuredClone(input), path, offset: 0, touchedAt: this.now(),
        released: false, controller: new AbortController(), parts: new Map() };
      this.jobs.set(id, job); this.reservedBytes += input.byteLength; return status(job);
    });
  }

  part(caller: ImageCaller, input: ImagePart): Promise<ImageStatus> {
    return this.run(caller, async () => {
      const job = this.require(caller, input);
      if (!input.bytes.byteLength || input.bytes.byteLength > BASE_IMAGE_PART_BYTES || digest(input.bytes) !== input.sha256) throw imageError("image_transfer_conflict");
      const previous = job.parts.get(input.offset);
      if (previous) {
        if (previous.bytes !== input.bytes.byteLength || previous.sha256 !== input.sha256) throw imageError("image_transfer_conflict");
        return status(job);
      }
      if (job.value || input.offset !== job.offset || input.offset + input.bytes.byteLength > job.input.byteLength) throw imageError("image_transfer_conflict");
      const file = await open(job.path, "r+");
      try {
        let written = 0;
        while (written < input.bytes.byteLength) {
          const result = await file.write(input.bytes, written, input.bytes.byteLength - written, input.offset + written);
          if (!result.bytesWritten) throw imageError("image_transfer_io"); written += result.bytesWritten;
        }
      } finally { await file.close(); }
      job.parts.set(input.offset, { bytes: input.bytes.byteLength, sha256: input.sha256 }); job.offset += input.bytes.byteLength;
      return status(job);
    });
  }

  finish(caller: ImageCaller, input: ImageTransferRequest): Promise<ImageStatus> {
    return this.run(caller, async () => {
      const job = this.require(caller, input); if (job.value) return status(job);
      if (job.offset !== job.input.byteLength) throw imageError("image_transfer_conflict");
      const hash = createHash("sha256"), header = Buffer.alloc(Math.min(512 * 1024, job.offset)); let bytes = 0;
      for await (const raw of createReadStream(job.path, { highWaterMark: BASE_IMAGE_PART_BYTES, signal: job.controller.signal })) {
        const chunk = raw as Buffer; hash.update(chunk);
        if (bytes < header.length) chunk.copy(header, bytes, 0, Math.min(chunk.length, header.length - bytes));
        bytes += chunk.length; if (bytes > job.input.byteLength) throw imageError("image_transfer_conflict");
      }
      if (bytes !== job.input.byteLength || hash.digest("hex") !== job.input.sha256) throw imageError("image_transfer_conflict");
      let value: BaseAttachmentValue;
      try { value = describeVerifiedImage({ ...job.input, header, sourceRevision: job.input.sha256 }); }
      catch { throw imageError("image_invalid"); }
      if (value.mediaType !== job.input.mediaType) throw imageError("image_invalid");
      try { await this.validateImage(await readFile(job.path, { signal: job.controller.signal }), value, job.controller.signal); }
      catch { throw imageError(job.controller.signal.aborted ? "image_transfer_missing" : "image_invalid"); }
      job.controller.signal.throwIfAborted();
      const file = await open(job.path, "r+"); try { await file.sync(); } finally { await file.close(); }
      job.value = value; return status(job);
    });
  }

  cancel(caller: ImageCaller, input: ImageTransferRequest) {
    // Abort outside the serial queue so cancellation can interrupt the active decoder.
    if (this.jobs.has(input.transferId)) this.require(caller, input).controller.abort();
    return this.run(caller, async () => {
      if (!this.jobs.has(input.transferId)) return;
      await this.drop(this.require(caller, input));
    });
  }

  withReady<T>(caller: ImageCaller, scope: ImageScope, ids: readonly string[], commit: (images: ReadonlyMap<string, ReadyImage>) => Promise<T>): Promise<T> {
    return this.run(caller, async () => {
      const jobs = [...new Set(ids)].map(transferId => this.require(caller, { ...scope, transferId }));
      if (jobs.some(job => !job.value)) throw imageError("image_transfer_conflict");
      const images = new Map(jobs.map(job => [job.id, { value: structuredClone(job.value!), persist: async () => {
        const bytes = job.released
          ? await this.attachments.read(ownerFileStem(scope.ownerKey), scope.ownerInstanceId, job.value!)
          : await readFile(job.path);
        if (bytes.length !== job.input.byteLength || digest(bytes) !== job.input.sha256) throw imageError("image_transfer_conflict");
        const result = await this.attachments.put({ chatId: ownerFileStem(scope.ownerKey), incarnationId: scope.ownerInstanceId,
          filename: job.input.filename, bytes, sourceRevision: job.input.sha256 });
        if (!isDeepStrictEqual(result.value, job.value)) throw imageError("image_transfer_conflict");
        return result.value;
      } }]));
      const result = await commit(images);
      // Retain the small receipt until the form acknowledges or expires; a lost IPC response can converge.
      for (const job of jobs) await this.releaseBytes(job);
      return result;
    });
  }

  closeRenderer(webContentsId: number) {
    this.closedRenderers.add(webContentsId);
    for (const job of this.jobs.values()) if (job.caller.webContentsId === webContentsId) job.controller.abort();
    return this.queue.enqueue(async () => { await this.ready;
      for (const job of this.jobs.values()) if (job.caller.webContentsId === webContentsId) await this.drop(job);
    });
  }
  async close() {
    clearInterval(this.timer);
    for (const job of this.jobs.values()) job.controller.abort();
    await this.queue.enqueue(async () => { await this.ready; for (const job of this.jobs.values()) await this.drop(job); });
    this.queue.close();
  }
  private run<T>(caller: ImageCaller, work: () => Promise<T>) {
    return this.queue.enqueue(async () => {
      await this.ready; if (this.closedRenderers.has(caller.webContentsId)) throw imageError("base_scope_changed");
      await this.expire();
      for (const job of this.jobs.values()) if (job.caller.webContentsId === caller.webContentsId && !sameCaller(job.caller, caller)) await this.drop(job);
      return work();
    });
  }
  private require(caller: ImageCaller, input: ImageTransferRequest) {
    const job = this.jobs.get(input.transferId); if (!job) throw imageError("image_transfer_missing");
    if (!sameCaller(caller, job.caller) || job.input.ownerKey !== input.ownerKey || job.input.ownerInstanceId !== input.ownerInstanceId ||
      job.input.surfaceLeaseId !== input.surfaceLeaseId) throw imageError("base_scope_changed");
    job.touchedAt = this.now(); return job;
  }
  private async expire() { for (const job of this.jobs.values()) if (this.now() - job.touchedAt >= TTL) await this.drop(job); }
  private async releaseBytes(job: Job) {
    if (job.released) return;
    await rm(job.path, { force: true }); job.released = true; this.reservedBytes -= job.input.byteLength;
  }
  private async drop(job: Job) { job.controller.abort(); await this.releaseBytes(job); this.jobs.delete(job.id); }
  private async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    for (const file of await readdir(this.directory, { withFileTypes: true })) {
      if (file.isFile() && /^[a-f0-9-]{36}\.part$/.test(file.name)) await rm(join(this.directory, file.name));
    }
  }
}
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const sameCaller = (left: ImageCaller, right: ImageCaller) => left.webContentsId === right.webContentsId && left.rendererIncarnation === right.rendererIncarnation;
const status = (job: Job): ImageStatus => ({ transferId: job.id, offset: job.offset, ...(job.value ? { value: structuredClone(job.value) } : {}) });
