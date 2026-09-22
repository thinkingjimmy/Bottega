/**
 * [INPUT]: Depends on verified Home ownership, exact file identities, optional independent clones, immutable Chat outbox source descriptors and the shared persistence directory guards.
 * [OUTPUT]: Freezes exact Home bytes with their chunk hashes, reuses proven unchanged files and locates retained snapshot content after restart.
 * [POS]: Home source holder; operation scheduling and receipts remain in the original ChatStore.
 */
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath, rename, unlink, readdir, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { contentBlobId, type BlobDescriptor } from "@ai-chat/cloud-protocol";
import { FILE_CHUNK_BYTES } from "@ai-chat/cloud-protocol/blobs/encrypted";
import { homePathSchema, EMPTY_HOME_DIGEST, extendHomeDigest, type HomeEntry } from "@ai-chat/cloud-protocol/chats/home/model";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { ChatHomeService } from "../../chat-home/chat-home-service";
import type { SyncScope } from "../../../../shared/local-storage/contracts";
import { frozenHomeSchema, type FrozenHome } from "../../chats/sqlite/cloud/delivery/home";
import { scanHomeFiles, type HomeFile } from "./scan";
import { ManagedHomeFiles, retainedManagedPaths } from "./restore/managed";
import { HomeReuseCache } from "./incremental/cache";
import { openHomeFile } from "./incremental/identity";
import { ensureDurableDirectory, ensureGuardedDirectory } from "../../persistence/durable-json";
type HomeCaptureIdentity = Pick<CloudChatHead, "homeSnapshotId"> & { chat: Pick<CloudChatHead["chat"], "id" | "incarnationId">; headSeq?: number };
const directory = (path: string) => ensureGuardedDirectory(path, "HOME_SOURCE_DIRECTORY_CHANGED");
export class HomeSourceCustody {
  readonly root: string;
  // Copying already hashes every chunk; the encryptor reuses those hashes instead of reading the whole Home a second time.
  private readonly chunks = new Map<string, string[]>();
  constructor(private readonly userData: string, private readonly scope: SyncScope, outboxId: string) {
    this.root = join(userData, "chat-home-sources", hashChatContent([scope, outboxId]));
  }
  path(blob: BlobDescriptor) { return join(this.root, `${blob.sha256}.bin`); }
  parts(blob: BlobDescriptor) { return this.chunks.get(blob.sha256) ?? null; }
  async read() { const source = await this.saved(); if (!source) throw new Error("HOME_SOURCE_UNAVAILABLE"); return source; }
  private async initialize() { await ensureDurableDirectory(this.root); }
  async capture(homes: ChatHomeService, head: HomeCaptureIdentity, snapshotId: string, signal: AbortSignal) {
    await this.initialize();
    const saved = await this.saved();
    if (saved) { signal.throwIfAborted(); return this.original(saved, head, snapshotId); }
    const record = homes.ledger.get(head.chat.id);
    if (!record || record.incarnationId !== head.chat.incarnationId) throw new Error("HOME_OWNERSHIP_UNAVAILABLE");
    await homes.committedCreationEvidence(head.chat.id, record.intentId);
    const cache = new HomeReuseCache(await realpath(join(this.userData, "chat-home-sources")), [this.scope, { id: head.chat.id, incarnationId: head.chat.incarnationId }, record.intentId]);
    return cache.use(async reusable => {
      // Another caller can freeze this same operation while it waits for Home custody.
      const concurrent = await this.saved();
      if (concurrent) { signal.throwIfAborted(); reusable.keepPrevious(); return this.original(concurrent, head, snapshotId); }
      const scan = await scanHomeFiles(record.homeDir, record.worktree?.relativePath, signal); await this.initialize();
      const entries: HomeEntry[] = [];
      const omissionPath = (path: string) => homePathSchema.safeParse(path).success ? path : `unavailable/${hashChatContent(path)}`;
      for (const omitted of scan.omitted) entries.push({ kind: "omitted", path: omissionPath(omitted.path), reason: omitted.reason });
      for (const file of scan.files) {
        signal.throwIfAborted();
        if (!homePathSchema.safeParse(file.path).success) { entries.push({ kind: "omitted", path: omissionPath(file.path), reason: "unsupported-file" }); continue; }
        let blob = await reusable.reuse(record.homeDir, file, value => this.path(value), signal);
        if (!blob) { blob = await this.copy(record.homeDir, file, signal); await reusable.retain(file, blob, this.path(blob), signal); }
        entries.push({ kind: "file", path: file.path, mode: file.mode, blob });
      }
      await homes.committedCreationEvidence(head.chat.id, record.intentId); signal.throwIfAborted();
      entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
      const source = frozenHomeSchema.parse({ manifest: { chatId: head.chat.id, incarnationId: head.chat.incarnationId,
        snapshotId, expectedSnapshotId: head.homeSnapshotId, throughSeq: head.headSeq ?? 0, entryCount: entries.length,
        digest: entries.reduce(extendHomeDigest, EMPTY_HOME_DIGEST), bytes: entries.reduce((sum, entry) => sum + (entry.kind === "file" ? entry.blob.bytes : 0), 0),
        omittedCount: entries.filter(entry => entry.kind === "omitted").length }, entries });
      const temporary = join(this.root, `.part-${randomUUID()}`), output = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await output.writeFile(JSON.stringify(source)); await output.sync(); } finally { await output.close(); }
      const managed = new ManagedHomeFiles(this.userData, [this.scope, { id: head.chat.id, incarnationId: head.chat.incarnationId }, record.intentId]);
      await managed.write(retainedManagedPaths(await managed.read(), entries));
      signal.throwIfAborted(); await rename(temporary, join(this.root, "manifest.json"));
      const parent = await open(this.root, constants.O_RDONLY); try { await parent.sync(); } finally { await parent.close(); }
      return source;
    });
  }
  private original(source: FrozenHome, head: HomeCaptureIdentity, snapshotId: string) {
    const manifest = source.manifest;
    if (manifest.chatId !== head.chat.id || manifest.incarnationId !== head.chat.incarnationId ||
      manifest.snapshotId !== snapshotId || manifest.expectedSnapshotId !== head.homeSnapshotId) throw new Error("HOME_SOURCE_IDENTITY_CHANGED");
    return source;
  }
  private async saved() {
    let file: Awaited<ReturnType<typeof open>>;
    try { file = await open(join(this.root, "manifest.json"), constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    try { const initial = await file.stat(); if (!initial.isFile() || initial.nlink !== 1 || initial.size > 32 * 1024 * 1024) throw new Error("HOME_SOURCE_CHANGED");
      const value = frozenHomeSchema.parse(JSON.parse(await file.readFile("utf8"))), after = await file.stat();
      if (initial.size !== after.size || initial.mtimeMs !== after.mtimeMs || initial.ctimeMs !== after.ctimeMs) throw new Error("HOME_SOURCE_CHANGED"); return value;
    } finally { await file.close(); }
  }
  private async copy(root: string, file: HomeFile, signal: AbortSignal) {
    const { handle: source, verify } = await openHomeFile(root, file), temporary = join(this.root, `.part-${randomUUID()}`);
    let output: Awaited<ReturnType<typeof open>> | null = null;
    try {
      await verify(); output = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      const hash = createHash("sha256"), chunks: string[] = [];
      // Chunking at FILE_CHUNK_BYTES makes each hash the exact part the encryptor freezes into its intent.
      for (let offset = 0; offset < file.bytes;) {
        signal.throwIfAborted(); await verify();
        const bytes = new Uint8Array(Math.min(FILE_CHUNK_BYTES, file.bytes - offset)); let read = 0;
        while (read < bytes.length) { const result = await source.read(bytes, read, bytes.length - read, offset + read); if (!result.bytesRead) throw new Error("HOME_SOURCE_CHANGED"); read += result.bytesRead; }
        hash.update(bytes); chunks.push(createHash("sha256").update(bytes).digest("hex")); let written = 0;
        while (written < bytes.length) { const result = await output.write(bytes, written, bytes.length - written); if (!result.bytesWritten) throw new Error("HOME_SOURCE_WRITE_FAILED"); written += result.bytesWritten; }
        offset += bytes.length;
      }
      await verify(); signal.throwIfAborted(); await output.sync(); await output.close(); output = null;
      const descriptor = { sha256: hash.digest("hex"), bytes: file.bytes, mime: "application/octet-stream" };
      const blob = { ...descriptor, blobId: contentBlobId(descriptor, this.scope.userId) };
      this.chunks.set(blob.sha256, chunks.length ? chunks : [createHash("sha256").update(new Uint8Array()).digest("hex")]);
      await directory(this.root); await rename(temporary, this.path(blob));
      const parent = await open(this.root, constants.O_RDONLY); try { await parent.sync(); } finally { await parent.close(); }
      return blob;
    } finally { await source.close(); await output?.close(); await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }); }
  }
  async release() {
    try {
      await directory(this.root);
      for (const entry of await readdir(this.root, { withFileTypes: true })) {
        if (!entry.isFile() || !/^([a-f0-9]{64}\.bin|\.part-[a-f0-9-]{36}|manifest\.json)$/.test(entry.name)) throw new Error("HOME_SOURCE_DIRECTORY_CHANGED");
        await unlink(join(this.root, entry.name));
      }
      await rmdir(this.root);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
}
