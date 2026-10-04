/**
 * [INPUT]: Depends on serialized durable filesystem ports, asynchronous native encryption and fixed build configuration.
 * [OUTPUT]: Provides guarded credentials, final-session cancellation, a disposable write probe and identity-bound removal completion without decryption.
 * [POS]: Main-only persistence; all readers and writers share one queue and an operation fence.
 */
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { CloudBuildConfig } from "@ai-chat/cloud-protocol";
import { isErrnoCode, syncDirectory } from "../../persistence/durable-json";
import { CredentialAccess, credentialFailure, StorageSuperseded } from "./storage/access";
import { emptyVault, vaultSchema, type CloudCredentials, type CredentialEncryption, type PendingLogin } from "./storage/schema";
export type { CloudCredentials, PendingLogin, CredentialEncryption } from "./storage/schema";
const filePorts = { lstat, open, rename, unlink, syncDirectory };
type Options = { guard?: () => boolean; retry?: boolean };
export class CredentialStore {
  private queue: Promise<unknown> = Promise.resolve();
  private version = 0;
  private removal: { target: string | null; unlinked: boolean } | null = null;
  readonly access = new CredentialAccess();
  readonly path: string;
  constructor(private readonly root: string, private readonly config: CloudBuildConfig,
    private readonly encryption: CredentialEncryption, private readonly platform = process.platform,
    private readonly files = filePorts) { this.path = join(root, "cloud-credentials.bin"); }
  get revision() { return this.version; }
  get canRetryRemoval() { return !!this.removal && this.access.blocked === "credential-write-failed" && !this.access.frozen; }
  // A failed write leaves nothing to remove; only a successful probe write proves the fault is gone.
  get canRetryWrite() { return !this.removal && this.access.blocked === "credential-write-failed" && !this.access.frozen; }
  drain() { return this.queue; }
  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const result = this.queue.then(run); this.queue = result.catch(() => undefined); return result;
  }
  private transaction<T>(run: (guard: () => void) => Promise<T>, options: Options = {}): Promise<T> {
    const generation = this.access.generation;
    return this.enqueue(async () => {
      const guard = () => { this.access.assert(generation, options.retry); if (options.guard && !options.guard()) throw new StorageSuperseded(); };
      try { guard(); const result = await run(guard); guard(); return result; }
      catch (error) { this.access.fail(error, generation); throw error; }
    });
  }
  async assertAvailable() {
    try {
      if (!await this.encryption.isAsyncEncryptionAvailable() || (this.platform === "linux" &&
        !["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"].includes(this.encryption.getSelectedStorageBackend?.() ?? "unknown"))) {
        throw new Error("credential-encryption-unavailable");
      }
    } catch { throw new Error("credential-encryption-unavailable"); }
  }
  private empty() { return emptyVault(this.config.environmentId, this.config.deploymentId); }
  private validate(value: unknown): CloudCredentials {
    const parsed = vaultSchema.safeParse(value);
    if (!parsed.success) throw new Error("credential-file-invalid");
    if (parsed.data.environmentId !== this.config.environmentId || parsed.data.deploymentId !== this.config.deploymentId) {
      throw new Error("credential-environment-mismatch");
    }
    return parsed.data;
  }
  private async identity(): Promise<string | null> {
    try {
      const stat = await this.files.lstat(this.path, { bigint: true });
      if (!stat.isFile() && !stat.isSymbolicLink()) throw new Error("credential-read-failed");
      return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.mode].join(":");
    } catch (error) { if (isErrnoCode(error, "ENOENT")) return null; throw error; }
  }
  inspect() { return this.enqueue(() => this.identity()); }
  inspectTarget() { return this.identity(); }
  private async readValue(guard: () => void): Promise<{ value: CloudCredentials; rotate: boolean }> {
    let bytes: Buffer;
    try {
      if ((await this.files.lstat(this.path)).isSymbolicLink()) throw new Error("credential-file-invalid");
      const file = await this.files.open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > 65_536 || stat.size === 0) throw new Error("credential-file-invalid");
        if (this.platform !== "win32" && (stat.mode & 0o077)) await file.chmod(0o600);
        bytes = await file.readFile();
      } finally { await file.close(); }
    } catch (error) {
      if (isErrnoCode(error, "ENOENT")) return { value: this.empty(), rotate: false };
      if (isErrnoCode(error, "ELOOP")) throw new Error("credential-file-invalid");
      throw credentialFailure(error) ? error : new Error("credential-read-failed", { cause: error });
    }
    guard(); await this.assertAvailable(); guard();
    let decrypted: Awaited<ReturnType<CredentialEncryption["decryptStringAsync"]>>;
    try { decrypted = await this.encryption.decryptStringAsync(bytes); }
    catch (cause) { throw new Error("credential-decryption-failed", { cause }); }
    guard();
    let parsed: unknown;
    try { parsed = JSON.parse(decrypted.result); } catch { throw new Error("credential-file-invalid"); }
    return { value: this.validate(parsed), rotate: decrypted.shouldReEncrypt };
  }
  read(): Promise<CloudCredentials> {
    return this.transaction(async guard => {
      const { value, rotate } = await this.readValue(guard);
      if (rotate) await this.writeValue(value, guard);
      return value;
    });
  }
  async session() {
    this.access.assert(); return (await this.read()).session;
  }
  private async writeValue(value: CloudCredentials, guard: () => void) {
    guard(); await this.assertAvailable(); guard();
    let bytes: Buffer;
    try { bytes = await this.encryption.encryptStringAsync(JSON.stringify(value)); }
    catch (cause) { throw new Error("credential-encryption-unavailable", { cause }); }
    guard();
    const temporary = this.path + "." + randomUUID() + ".tmp";
    try {
      const file = await this.files.open(temporary, "wx", 0o600);
      try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
      guard();
      await this.files.rename(temporary, this.path); this.version++;
      await this.files.syncDirectory(this.root); guard();
    } catch (error) {
      if (error instanceof StorageSuperseded) throw error;
      throw new Error("credential-write-failed", { cause: error });
    } finally { await this.files.unlink(temporary).catch(() => undefined); }
  }
  update(change: (current: CloudCredentials) => CloudCredentials | null, options: Options = {}): Promise<CloudCredentials> {
    return this.transaction(async guard => {
      const { value: current } = await this.readValue(guard);
      const changed = change(current);
      if (changed === null) {
        if (options.retry) try { await this.files.syncDirectory(this.root); }
        catch (cause) { throw new Error("credential-write-failed", { cause }); }
        return current;
      }
      const value = this.validate(changed); await this.writeValue(value, guard); return value;
    }, options);
  }
  async retryUpdate(change: (current: CloudCredentials) => CloudCredentials | null, guard: () => boolean) {
    if (this.access.blocked !== "credential-write-failed") throw new Error("credential-retry-unavailable");
    const generation = this.access.generation;
    const result = await this.update(change, { guard, retry: true });
    this.access.recovered(generation); return result;
  }
  // Recovery after a write failure that saved nothing: a disposable file proves the directory and
  // the native encryption are usable again without recreating a credential the account no longer owns.
  async retryWrite(guard: () => boolean) {
    if (!this.canRetryWrite) throw new Error("credential-retry-unavailable");
    const generation = this.access.generation;
    await this.transaction(async check => {
      check(); await this.assertAvailable(); check();
      let bytes: Buffer;
      try { bytes = await this.encryption.encryptStringAsync(this.config.environmentId); }
      catch (cause) { throw new Error("credential-encryption-unavailable", { cause }); }
      check();
      const source = this.path + "." + randomUUID() + ".probe", target = source + ".committed";
      try {
        const file = await this.files.open(source, "wx", 0o600);
        try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
        check(); await this.files.rename(source, target); await this.files.syncDirectory(this.root); check();
      } catch (error) {
        if (error instanceof StorageSuperseded) throw error;
        throw new Error("credential-write-failed", { cause: error });
      } finally { for (const path of [source, target]) await this.files.unlink(path).catch(() => undefined); }
    }, { guard, retry: true });
    this.access.recovered(generation);
  }
  async retryRead() {
    // Only filesystem failures have a supported same-process retry policy.
    if (this.access.blocked !== "credential-read-failed") throw new Error("credential-retry-unavailable");
    const generation = this.access.generation;
    const value = await this.transaction(async guard => {
      const result = await this.readValue(guard); if (result.rotate) await this.writeValue(result.value, guard); return result.value;
    }, { retry: true });
    this.access.recovered(generation); return value;
  }
  private async remove() {
    try {
      const target = await this.identity();
      const removal = this.removal ??= { target, unlinked: target === null };
      if (removal.unlinked ? target !== null : target !== null && target !== removal.target) throw new StorageSuperseded();
      if (!removal.unlinked) {
        if (target !== null) { await this.files.unlink(this.path); this.version++; }
        removal.unlinked = true;
      }
      await this.files.syncDirectory(this.root);
      this.removal = null;
    } catch (cause) { throw new Error("credential-write-failed", { cause }); }
  }
  async retryRemoval(guard: () => boolean) {
    if (!this.canRetryRemoval) throw new Error("credential-retry-unavailable");
    const generation = this.access.generation;
    await this.transaction(async check => { check(); await this.remove(); }, { guard, retry: true });
    this.access.recovered(generation);
  }
  clear(guard?: () => boolean): Promise<void> {
    return this.transaction(async check => { check(); await this.remove(); }, { guard });
  }
  finishLogin(state: string, exchangeId: string | undefined, guard: () => boolean): Promise<void> {
    return this.transaction(async check => {
      const { value } = await this.readValue(check);
      if (value.login?.state !== state || value.login.exchangeId !== exchangeId) return;
      check(); await this.remove();
    }, { guard });
  }
  cancelLogin(state: string, exchangeId: string | undefined, guard: () => boolean, finalizing?: PendingLogin): Promise<CloudCredentials | null> {
    const generation = this.access.generation;
    // The queue must discover ENOENT before touching crypto, even after an encryption refusal.
    return this.enqueue(async () => {
      if (generation !== this.access.generation || this.access.frozen || !guard()) throw new StorageSuperseded();
      if (await this.identity() === null) return null;
      const check = () => { this.access.assert(generation); if (!guard()) throw new StorageSuperseded(); };
      try {
        check(); const { value } = await this.readValue(check);
        // The final save may have removed login before its caller observed the commit.
        const pending = value.login ?? (finalizing?.phase === "registering" && finalizing.issuedSessionId === value.session?.sessionId ? finalizing : null);
        if (!pending) { if (value.session) throw new StorageSuperseded(); return null; }
        if (pending.state !== state || pending.exchangeId !== exchangeId) throw new StorageSuperseded();
        if (value.login?.cancelRequested) return value;
        const next = this.validate({ ...value, login: { ...pending, cancelRequested: true } });
        await this.writeValue(next, check); return next;
      } catch (error) { this.access.fail(error, generation); throw error; }
    });
  }
  resetInvalid(): Promise<void> {
    const generation = this.access.generation;
    return this.transaction(async guard => {
      try { await this.readValue(guard); }
      catch (error) {
        if (credentialFailure(error) !== "credential-file-invalid") throw error;
        guard(); await this.remove();
      }
      this.access.recovered(generation);
    }, { retry: true });
  }
  discard(target: string, guard: () => boolean): Promise<void> {
    return this.enqueue(async () => {
      if (!this.access.frozen || !guard()) throw new StorageSuperseded();
      const current = await this.identity();
      if (current !== null && current !== target) throw new Error("credential-review-expired");
      if (!guard()) throw new StorageSuperseded();
      if (this.removal && this.removal.target !== target) this.removal = null;
      await this.remove();
    });
  }
}
