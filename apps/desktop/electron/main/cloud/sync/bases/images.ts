/**
 * [INPUT]: Depends on authenticated private-file transport, account lifecycle ownership and BaseStore reference/cache admission.
 * [OUTPUT]: Downloads verified missing Base images with bounded concurrency and drained cancellation; local-only markers are never downloaded.
 * [POS]: Main-only Gallery downlink; existing image readers share the same owner-local bytes without changing Base facts.
 */
import { readFile } from "node:fs/promises";
import type { BlobTransferPorts, CloudBuildConfig } from "@ai-chat/cloud-protocol";
import type { BaseStore } from "../../../bases/base-store";
import { ownerKeyFromStem } from "../../../bases/store/base-files";
import type { MissingBaseAttachment } from "../../../bases/store/attachments";
import { DesktopBlobStore } from "../../files/store";
import type { CloudAccountService } from "../../runtime/service";
import type { SyncBindingStore } from "../account/binding";
type Job = { promise: Promise<void>; close(): Promise<void> };
export class BaseImageReader {
  private closed = false;
  private running = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly jobs = new Map<string, Job>();
  private readonly detach: () => void;
  constructor(private readonly input: { config: CloudBuildConfig; userData: string; store: BaseStore;
    binding: Pick<SyncBindingStore, "snapshot">; account: Pick<CloudAccountService, "snapshot">;
    filePorts(userId: string): BlobTransferPorts; own(activity: { close(): Promise<void> }): () => void }) {
    this.detach = input.store.attachments.setMissingReader(value => this.read(value));
  }
  private scope(value: MissingBaseAttachment) {
    const binding = this.input.binding.snapshot(), account = this.input.account.snapshot();
    if (this.closed || !binding || binding.phase === "closing" || binding.paused || account.profile?.userId !== binding.userId ||
      account.deviceId !== binding.deviceId || !["ready", "temporarily-offline"].includes(account.status)) throw new Error("BASE_IMAGE_ACCOUNT_UNAVAILABLE");
    const ownerKey = ownerKeyFromStem(value.ownerStem);
    const scope = this.input.store.sync.attachmentScope(ownerKey, value.ownerInstanceId, value.value.blobId);
    if (scope.environment !== this.input.config.environmentId || scope.userId !== binding.userId) throw new Error("BASE_IMAGE_ACCOUNT_CHANGED");
    return { ...scope, ownerKey };
  }
  private async read(value: MissingBaseAttachment) {
    if (value.value.localAvailability) throw new Error("SOURCE_LOCAL_ONLY");
    const scope = this.scope(value), key = JSON.stringify([scope, value.ownerInstanceId, value.value.blobId]);
    const existing = this.jobs.get(key); if (existing) return existing.promise;
    if (this.jobs.size >= 128) throw new Error("BASE_IMAGE_QUEUE_FULL");
    const controller = new AbortController();
    const job: Job = { promise: Promise.resolve(), close: async () => {
      controller.abort(new Error("BASE_IMAGE_READ_CLOSED")); await job.promise.catch(() => {});
    } };
    const release = this.input.own(job);
    this.jobs.set(key, job);
    job.promise = this.download(value, scope, controller.signal).finally(() => { release(); this.jobs.delete(key); });
    return job.promise;
  }
  private async slot(signal: AbortSignal) {
    signal.throwIfAborted();
    if (this.running < 2) { this.running++; return; }
    await new Promise<void>((resolve, reject) => {
      const admit = () => { signal.removeEventListener("abort", abort); resolve(); };
      const abort = () => { const index = this.waiting.indexOf(admit); if (index >= 0) this.waiting.splice(index, 1); reject(signal.reason); };
      this.waiting.push(admit); signal.addEventListener("abort", abort, { once: true });
    });
  }
  private releaseSlot() {
    const next = this.waiting.shift(); if (next) next(); else this.running--;
  }
  private async download(value: MissingBaseAttachment, scope: ReturnType<BaseImageReader["scope"]>, signal: AbortSignal) {
    await this.slot(signal);
    let files: DesktopBlobStore | null = null;
    try {
      signal.throwIfAborted();
      const sha256 = /^att_([a-f0-9]{64})\.(png|jpe?g|webp|gif)$/.exec(value.value.blobId)?.[1];
      if (!sha256) throw new Error("BASE_ATTACHMENT_IDENTITY_CHANGED");
      files = new DesktopBlobStore(this.input.userData, { ...this.input.config, userId: scope.userId }, this.input.filePorts(scope.userId));
      const mapping = this.input.store.sync.encryptedFiles.image({ ownerKey: scope.ownerKey, baseId: value.ownerInstanceId }, scope, value.value.blobId);
      if (!mapping || mapping.descriptor.sha256 !== sha256 || mapping.descriptor.bytes !== value.value.byteLength || mapping.descriptor.mime !== value.value.mediaType) throw new Error("BASE_ENCRYPTED_FILE_MAPPING_REQUIRED");
      const descriptor = mapping.descriptor;
      const file = await files.read(descriptor, { kind: "base", id: value.ownerInstanceId }, signal);
      const bytes = await readFile(file.path, { signal });
      signal.throwIfAborted();
      if (this.scope(value).userId !== scope.userId) throw new Error("BASE_IMAGE_ACCOUNT_CHANGED");
      await this.input.store.sync.cacheAttachment(scope.ownerKey, value.ownerInstanceId, scope, value.value, bytes, signal);
    } finally { try { await files?.close(); } finally { this.releaseSlot(); } }
  }
  async close() { this.closed = true; this.detach(); await Promise.all([...this.jobs.values()].map(job => job.close())); }
}
