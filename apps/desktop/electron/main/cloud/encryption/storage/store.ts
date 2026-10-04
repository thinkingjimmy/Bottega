/**
 * [INPUT]: Native asynchronous encryption, the existing serial queue and guarded durable byte publication.
 * [OUTPUT]: Lazy account/installation-bound key-cache reads, verified replacement, explicit retry and independent removal.
 * [POS]: Main-only E2EE key persistence; the login vault and business Store/outbox remain independent owners.
 */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { CloudBuildConfig } from "@ai-chat/cloud-protocol";
import type { CredentialEncryption } from "../../account/storage/schema";
import { durableReplaceBytes, isErrnoCode, syncDirectory } from "../../../persistence/durable-json";
import { SerialQueue } from "../../../persistence/serial-queue";
import { parseSyncKeyRecord, SyncKeyStorageError, type SyncKeyRecord, type SyncKeyStorageCode } from "./model";
const filePorts = { lstat, open, unlink, publish: durableReplaceBytes, syncDirectory };
type Options = { guard?: () => boolean; retry?: boolean };
export class SyncKeyStore {
  private readonly queue = new SerialQueue();
  private epoch = 0;
  private closed = false;
  private fault: SyncKeyStorageCode | null = null;
  private nativeUnavailable = false;
  readonly directory: string;
  constructor(userData: string, private readonly config: CloudBuildConfig, private readonly installationId: string,
    private readonly encryption: CredentialEncryption, private readonly platform = process.platform, private readonly files = filePorts) {
    this.directory = join(userData, "sync-keys");
  }
  get blocked() { return this.nativeUnavailable ? "sync-key-storage-unavailable" as const : this.fault; }
  path(userId: string) {
    if (!userId || userId.length > 128) throw new SyncKeyStorageError("sync-space-changed");
    const identity = JSON.stringify([1, this.config.environmentId, this.config.deploymentId, this.installationId, userId]);
    return join(this.directory, createHash("sha256").update(identity).digest("hex") + ".bin");
  }
  invalidate() { this.epoch++; }
  private check(epoch: number, options: Options) {
    if (this.closed || epoch !== this.epoch || options.guard?.() === false) throw new SyncKeyStorageError("sync-operation-cancelled");
    if (this.blocked && !options.retry) throw new SyncKeyStorageError(this.blocked);
  }
  private transact<T>(options: Options, operation: (guard: () => void) => Promise<T>): Promise<T> {
    const epoch = this.epoch;
    return this.queue.enqueue(async () => {
      const guard = () => this.check(epoch, options);
      try {
        guard(); const result = await operation(guard); guard(); this.fault = null; return result;
      } catch (error) {
        const safe = error instanceof SyncKeyStorageError ? error : new SyncKeyStorageError("sync-key-cache-unreadable");
        if (epoch === this.epoch && safe.code !== "sync-operation-cancelled" && safe.code !== "sync-space-changed") {
          this.fault = safe.code;
          if (safe.code === "sync-key-storage-unavailable") this.nativeUnavailable = true;
        }
        throw safe;
      }
    });
  }
  private async available(guard: () => void) {
    guard();
    try {
      if (!await this.encryption.isAsyncEncryptionAvailable() || this.platform === "linux" &&
        !["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"].includes(this.encryption.getSelectedStorageBackend?.() ?? "unknown")) {
        throw new Error("native-storage-unavailable");
      }
    } catch { throw new SyncKeyStorageError("sync-key-storage-unavailable"); }
    guard();
    this.nativeUnavailable = false;
  }
  private bound(value: unknown, userId: string) {
    const result = parseSyncKeyRecord(value);
    if (result.environmentId !== this.config.environmentId || result.deploymentId !== this.config.deploymentId ||
      result.installationId !== this.installationId || result.userId !== userId) throw new SyncKeyStorageError("sync-space-changed");
    return result;
  }
  read(userId: string, options: Options = {}): Promise<SyncKeyRecord | null> {
    const path = this.path(userId);
    return this.transact(options, async guard => {
      let bytes: Buffer;
      try {
        const entry = await this.files.lstat(path);
        if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1) throw new Error("invalid-key-file");
        const file = await this.files.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const stat = await file.stat();
          if (!stat.isFile() || stat.nlink !== 1 || stat.size === 0 || stat.size > 65_536) throw new Error("invalid-key-file");
          if (this.platform !== "win32" && stat.mode & 0o077) await file.chmod(0o600);
          bytes = await file.readFile();
        } finally { await file.close(); }
      } catch (error) {
        if (isErrnoCode(error, "ENOENT")) return null;
        throw new SyncKeyStorageError("sync-key-cache-unreadable");
      }
      guard(); await this.available(guard);
      let decoded: Awaited<ReturnType<CredentialEncryption["decryptStringAsync"]>>;
      try { decoded = await this.encryption.decryptStringAsync(bytes); }
      catch { throw new SyncKeyStorageError("sync-key-cache-unreadable"); }
      finally { bytes.fill(0); }
      guard();
      const record = this.bound(JSON.parse(decoded.result), userId);
      if (decoded.shouldReEncrypt) await this.persist(record, guard);
      return record;
    });
  }
  private async persist(record: SyncKeyRecord, guard: () => void) {
    await this.available(guard);
    let bytes: Buffer;
    try { bytes = await this.encryption.encryptStringAsync(JSON.stringify(record)); }
    catch { throw new SyncKeyStorageError("sync-key-storage-unavailable"); }
    try {
      guard();
      await this.files.publish(this.path(record.userId), bytes, 0o600, guard);
    } catch (error) {
      if (error instanceof SyncKeyStorageError) throw error;
      throw new SyncKeyStorageError("sync-key-save-failed");
    } finally { bytes.fill(0); }
  }
  /** Only an owner that has verified the immutable package/root may replace unreadable material. */
  async saveVerified(value: SyncKeyRecord, options: Options = {}) {
    const record = this.bound(value, value.userId);
    return this.transact(options, async guard => { await this.persist(record, guard); });
  }
  clear(userId: string, guard: () => boolean = () => true) {
    const path = this.path(userId);
    this.invalidate();
    // The captured account path cannot remove a later account's key, even when decryption is unavailable.
    return this.transact({ guard, retry: true }, async check => {
      check();
      try { await this.files.unlink(path); }
      catch (error) { if (!isErrnoCode(error, "ENOENT")) throw new SyncKeyStorageError("sync-key-save-failed"); }
      try { await this.files.syncDirectory(this.directory); }
      catch (error) { if (!isErrnoCode(error, "ENOENT")) throw new SyncKeyStorageError("sync-key-save-failed"); }
    });
  }
  drain() { return this.queue.flush(); }
  async close() { this.closed = true; this.invalidate(); this.queue.close(); await this.queue.flush(); }
}
