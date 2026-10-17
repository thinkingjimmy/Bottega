/**
 * [INPUT]: Main Chat/workspace facts, admission/generation guards, complete capture, canonical Canvas keys and durable storage.
 * [OUTPUT]: Check/status, guarded source/Canvas CAS, durable conflicts, semantic history, bounded recovery and exact Fork/Chat lifecycle.
 * [POS]: One document journal for Agent/source/Canvas/restore/system changes; no second registry or legacy App index.
 */
import { randomUUID } from "node:crypto";
import { lstat, readdir, realpath } from "node:fs/promises";
import { watch } from "node:fs";
import { join } from "node:path";
import { packArtifactArchive, unpackArtifactArchive } from "@ai-chat/cloud-protocol/artifacts/archive";
import { SerialQueue } from "../../persistence/serial-queue";
import { interruptionPoint } from "../../startup/boot/composition-hooks";
import { readArtifactSource } from "../../artifacts/storage/guarded-read";
import { assertHtmlDocument } from "../workspace/access";
import { DESIGN_LIMITS, DesignDocumentError, designDigest, requestKey, type DesignAuthority } from "./model";
import { readDesignSet, stableDesignSet } from "./read-set";
import { DESIGN_UNCHECKED, requireValidDesignSet, validateDesignSet } from "./resources/validation";
import { DesignDocumentStore, type DesignOperation, type DesignRevision } from "./store";
import { applyPreparedDesignEdit, transformedDesignSet } from "./edits";
import { summarizeDesignBoards, type WorkspaceCommand } from "@ai-chat/cloud-protocol/artifacts/design/model";
import type { DesignReadSet, DesignManifest } from "./model";
import { canonicalJson } from "@bottega/contracts/core/canonical-json";

export type DesignCommitInput = Readonly<{ path: string; requestId: string; expectedRevision: number; readSetDigest: string }>;
const RECOVERY_DELAYS = [250, 500, 1_000, 2_000, 4_000] as const;
type RecoveryState = { status: "retrying" | "paused" | "authority-blocked"; attempts: number;
  nextRetryAt?: number; code: string; message: string; action: string };
export type DesignDocumentPorts = Readonly<{
  assertAdmission(): void;
  resolve(chatId: string, incarnationId: string): DesignAuthority;
  deliver(revision: DesignRevision, data: Uint8Array): Promise<void>;
}>;

export class DesignDocuments {
  readonly store: DesignDocumentStore;
  private readonly queue = new SerialQueue();
  private readonly recovering = new Map<string, RecoveryState>();
  private readonly recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private closed = false;
  constructor(root: string, private readonly ports: DesignDocumentPorts) { this.store = new DesignDocumentStore(root); }
  async initialize() {
    await this.store.initialize();
    // Recovery owns prepared bytes even while the plugin is off; it cannot admit new work.
    await this.queue.enqueue(async () => {
      for (const operation of this.store.pending()) {
        await this.resume(operation);
      }
    });
  }
  authority(chatId: string, incarnationId: string) { return this.ports.resolve(chatId, incarnationId); }
  async singleHtml(chatId: string, incarnationId: string, file: string) {
    this.ports.assertAdmission();
    if (!/^design\/[A-Za-z0-9][A-Za-z0-9._ -]{0,199}\.html$/i.test(file)) throw new DesignDocumentError("PATH_DENIED", "Invalid single HTML path");
    const authority = this.authority(chatId, incarnationId);
    const bytes = Buffer.from(await readArtifactSource(join(await realpath(authority.workspace), file), DESIGN_LIMITS.html));
    assertHtmlDocument(bytes); this.assertAuthority(authority);
    return bytes;
  }
  async check(chatId: string, incarnationId: string, path: string, signal: AbortSignal) {
    this.ports.assertAdmission();
    const authority = this.authority(chatId, incarnationId);
    const stable = await stableDesignSet(authority.workspace, path, signal);
    this.assertAuthority(authority);
    const result = await validateDesignSet(stable.readSet);
    if (result.manifest?.systems?.length) result.issues = [...result.issues, ...await (await import("../systems/service")).validateSystemBindings(stable.readSet, authority)].slice(0, DESIGN_LIMITS.issues);
    this.assertAuthority(authority);
    const latest = result.manifest ? this.store.latest(authority.ownerId, result.manifest.documentId, authority) : null;
    if (latest && (latest.authority.chatId !== chatId || latest.authority.incarnationId !== incarnationId))
      throw new DesignDocumentError("PATH_DENIED", "This document ID belongs to another Chat");
    return { status: result.issues.length ? "invalid" : "ready", path,
      readSetDigest: stable.readSet.readSetDigest, expectedRevision: latest?.revision ?? 0,
      files: stable.readSet.files.map(file => ({ path: file.path, digest: file.digest, bytes: file.data.length })),
      bytes: stable.readSet.bytes, waitedMs: stable.waitedMs, stability: { quietMs: DESIGN_LIMITS.stableMs,
        intervalMs: DESIGN_LIMITS.intervalMs, timeoutMs: DESIGN_LIMITS.waitMs },
      issues: result.issues, unchecked: DESIGN_UNCHECKED,
      recovery: this.recoveryStatus(authority, path.split("/")[1]) };
  }
  commit(chatId: string, incarnationId: string, backend: string, input: DesignCommitInput, signal: AbortSignal) {
    this.ports.assertAdmission();
    if (this.closed) throw new DesignDocumentError("NOT_READY", "Document storage is closed. Reopen the application before saving.");
    const authority = this.authority(chatId, incarnationId);
    return this.queue.enqueue(async () => {
      this.assertAuthority(authority);
      const key = requestKey(authority, input.requestId);
      const parameterDigest = designDigest(JSON.stringify([authority, input.path, input.requestId, input.expectedRevision, input.readSetDigest]));
      const existing = this.store.operation(key);
      if (existing) {
        if (existing.parameterDigest !== parameterDigest) throw new DesignDocumentError("REQUEST_MISMATCH", "requestId was used with different parameters");
        if (existing.state === "complete") return receipt(existing.revision);
        if (existing.conflict) return this.conflictReceipt(existing);
        if (this.recovering.get(key)?.status === "retrying") return this.pendingReceipt(existing);
        this.recovering.delete(key);
        return this.resume(existing);
      }
      signal.throwIfAborted();
      const documentId = input.path.split("/")[1]!;
      const pending = this.store.blocking().find(operation => operation.revision.authority.ownerId === authority.ownerId &&
        operation.revision.manifest.documentId === documentId);
      if (pending) {
        const recovery = this.recoveryDetails(pending);
        throw new DesignDocumentError("NOT_READY", `Earlier operation ${recovery.requestId} is ${recovery.status}. ${recovery.action}`);
      }
      const previous = this.store.latest(authority.ownerId, documentId, authority);
      if (previous && (previous.authority.chatId !== chatId || previous.authority.incarnationId !== incarnationId))
        throw new DesignDocumentError("PATH_DENIED", "This document ID belongs to another Chat");
      if ((previous?.revision ?? 0) !== input.expectedRevision)
        throw new DesignDocumentError("REVISION_CONFLICT", `Current revision is ${previous?.revision ?? 0}. Read it before editing.`);
      const source = await readDesignSet(authority.workspace, input.path);
      if (source.readSetDigest !== input.readSetDigest) throw new DesignDocumentError("SOURCE_CHANGED", "Source changed after design_check; nothing was committed");
      const manifest = await requireValidDesignSet(source);
      if (manifest.systems?.length) { const issues = await (await import("../systems/service")).validateSystemBindings(source, authority);
        if (issues.length) throw new DesignDocumentError("INVALID_DOCUMENT", "System bindings do not match their exact frozen revisions", issues); }
      const verified = await readDesignSet(authority.workspace, input.path);
      if (verified.readSetDigest !== source.readSetDigest || verified.files.some((file, index) => file.stamp !== source.files[index]?.stamp))
        throw new DesignDocumentError("SOURCE_CHANGED", "Source changed during capture; nothing was committed");
      signal.throwIfAborted(); this.assertAuthority(authority);
      return this.publish(authority, backend, input, source, manifest, key, parameterDigest);

    });
  }
  edit(input: WorkspaceCommand, version: DesignRevision,
    transform: (source: DesignReadSet) => Promise<readonly { path: string; data: Uint8Array }[]>, assertExecution: () => void = () => undefined) {
    this.ports.assertAdmission();
    if (this.closed) throw new DesignDocumentError("NOT_READY", "Document storage is closed. Reopen the application before saving.");
    if (!input.requestId || input.expectedRevision === undefined || !input.readSetDigest) throw new DesignDocumentError("INVALID_DOCUMENT", "Edit requires a request ID, revision and digest");
    const authority = this.authority(input.chatId, input.incarnationId);
    return this.queue.enqueue(async () => {
      assertExecution();
      this.assertAuthority(authority);
      const parameters = [authority, "workspace-edit", input];
      const key = requestKey(authority, input.requestId!), parameterDigest = designDigest(input.action === "canvas" ? canonicalJson(parameters) : JSON.stringify(parameters));
      const existing = this.store.operation(key);
      if (existing) {
        if (existing.parameterDigest !== parameterDigest) throw new DesignDocumentError("REQUEST_MISMATCH", "requestId was used with different edit parameters");
        if (existing.state === "complete") return receipt(existing.revision);
        if (existing.conflict) return this.conflictReceipt(existing);
        if (this.recovering.get(key)?.status === "retrying") return this.pendingReceipt(existing);
        this.recovering.delete(key); return this.resume(existing);
      }
      const previous = this.store.latest(authority.ownerId, version.manifest.documentId, authority);
      if (!previous || previous.authority.chatId !== input.chatId || previous.authority.incarnationId !== input.incarnationId)
        throw new DesignDocumentError("PATH_DENIED", "A retained reference cannot edit another Chat's source");
      if (previous.revision !== input.expectedRevision || previous.readSetDigest !== input.readSetDigest || input.action !== "restore" && previous.artifactId !== input.artifactId)
        throw new DesignDocumentError("REVISION_CONFLICT", "The current revision changed. Your input is retained.");
      if (input.historyAction) {
        const navigation = this.store.navigation(authority, previous.manifest.documentId);
        if (input.action !== "restore" || input.targetRevision !== (input.historyAction === "undo" ? navigation.undoRevision : navigation.redoRevision))
          throw new DesignDocumentError("REVISION_CONFLICT", "The undo/redo target changed. Your input is retained.");
      }
      if (this.store.blocking().some(operation => operation.revision.authority.ownerId === authority.ownerId && operation.revision.manifest.documentId === version.manifest.documentId))
        throw new DesignDocumentError("NOT_READY", "An earlier save has an unknown result. Keep its original request ID.");
      const baseline = await readDesignSet(authority.workspace, previous.path);
      if (baseline.readSetDigest !== input.readSetDigest) throw new DesignDocumentError("SOURCE_CHANGED", "Source has unsaved changes. Your input is retained.");
      const source = transformedDesignSet(previous.path, await transform(baseline)), manifest = await requireValidDesignSet(source);
      if (manifest.systems?.length) { const issues = await (await import("../systems/service")).validateSystemBindings(source, authority);
        if (issues.length) throw new DesignDocumentError("INVALID_DOCUMENT", "System bindings do not match their exact frozen revisions", issues); }
      const current = await readDesignSet(authority.workspace, previous.path);
      if (current.readSetDigest !== baseline.readSetDigest) throw new DesignDocumentError("SOURCE_CHANGED", "Source changed during editing. Nothing was saved.");
      assertExecution();
      this.assertAuthority(authority);
      return this.publish(authority, previous.backend, { path: previous.path, requestId: input.requestId!, expectedRevision: previous.revision, readSetDigest: baseline.readSetDigest },
        source, manifest, key, parameterDigest, { input, baseline: baseline.files.map(file => ({ path: file.path, digest: file.digest })), writes: [], applied: false });
    });
  }
  operationStatus(input: WorkspaceCommand, retry = false) {
    const authority = this.authority(input.chatId, input.incarnationId);
    if (!input.requestId) throw new DesignDocumentError("INVALID_DOCUMENT", "An original request ID is required");
    const key = requestKey(authority, input.requestId), operation = this.store.operation(key);
    if (!operation || operation.revision.manifest.documentId !== input.documentId || operation.sourceEdit?.input.artifactId !== input.artifactId)
      throw new DesignDocumentError("PATH_DENIED", "Original edit is not available to this reference");
    this.assertAuthority(operation.revision.authority);
    if (operation.state === "complete") return Promise.resolve(receipt(operation.revision));
    if (operation.conflict) return Promise.resolve(this.conflictReceipt(operation));
    if (!retry || this.recovering.get(key)?.status === "retrying") return Promise.resolve(this.pendingReceipt(operation));
    this.ports.assertAdmission();
    return this.queue.enqueue(async () => { this.recovering.delete(key); return this.resume(operation); });
  }
  resolveConflict(input: WorkspaceCommand, assertExecution: () => void) {
    this.ports.assertAdmission();
    return this.queue.enqueue(async () => {
      assertExecution();
      const authority = this.authority(input.chatId, input.incarnationId), operation = input.requestId ? this.store.operation(requestKey(authority, input.requestId)) : null;
      if (!operation?.conflict || operation.revision.manifest.documentId !== input.documentId || operation.sourceEdit?.input.artifactId !== input.artifactId)
        throw new DesignDocumentError("PATH_DENIED", "Original source conflict is not available to this reference");
      this.assertAuthority(operation.revision.authority);
      return this.conflictReceipt(await this.store.resolveConflict(operation.key));
    });
  }
  private async publish(authority: DesignAuthority, backend: string, input: DesignCommitInput, source: DesignReadSet,
    manifest: DesignManifest, key: string, parameterDigest: string, sourceEdit?: DesignOperation["sourceEdit"]) {
      const archive = packArtifactArchive(source.files.map(file => ({ path: file.path, data: file.data })));
      if (archive.length > DESIGN_LIMITS.archive) throw new DesignDocumentError("BUDGET_EXCEEDED", "Complete archive exceeds the transfer budget");
      const snapshotRef = designDigest(archive), artifactId = randomUUID(), createdAt = Date.now();
      const suffix = ` · v${input.expectedRevision + 1}`;
      let title = manifest.title;
      while (title.length + suffix.length > 250) title = Array.from(title).slice(0, -1).join("");
      const revision: DesignRevision = { authority, path: input.path, manifest, revision: input.expectedRevision + 1,
        ...(sourceEdit?.input.historyAction ? { history: { action: sourceEdit.input.historyAction, targetRevision: sourceEdit.input.targetRevision! } } : {}),
        readSetDigest: source.readSetDigest, snapshotRef, requestId: input.requestId, createdAt, artifactId,
        messageId: "design-" + designDigest(key).slice(7, 39), backend,
        fence: { v: 1, id: artifactId, kind: manifest.format === "bottega-design-system" ? "design-system" : "design", title: title + suffix,
          identityKey: `${input.path}/canvas.json`, location: "workspace", sha256: snapshotRef.slice(7),
          bytes: archive.length, mime: "application/x-tar", createdAt,
          design: { documentId: manifest.documentId, revision: input.expectedRevision + 1, readSetDigest: source.readSetDigest,
            snapshotRef, format: manifest.format, launchBoard: manifest.launchBoard, boards: summarizeDesignBoards(manifest) } } };
      await this.store.archive(snapshotRef, archive);
      this.assertAuthority(authority);
      const operation: DesignOperation = { key, parameterDigest, state: "prepared", revision, ...(sourceEdit ? { sourceEdit } : {}) };
      await this.store.prepare(operation);
      // Cancellation after prepare cannot turn an admitted durable commit into a second operation.
      return this.resume(operation);
  }
  private async resume(operation: DesignOperation) {
    operation = this.store.operation(operation.key)!;
    if (operation.state === "complete") return receipt(operation.revision);
    if (operation.conflict) return this.conflictReceipt(operation);
    if (this.closed) return this.pendingReceipt(operation);
    const attempts = (this.recovering.get(operation.key)?.attempts ?? 0) + 1;
    try {
      interruptionPoint("document-commit", "prepared");
      const conflict = await this.finish(operation);
      if (conflict) return this.conflictReceipt(conflict);
      return receipt(operation.revision);
    } catch (cause) {
      const blocked = cause instanceof DesignDocumentError && cause.code === "PATH_DENIED";
      const retryDelay = RECOVERY_DELAYS[attempts - 1];
      const retrying = !blocked && !this.closed && retryDelay !== undefined;
      const status = blocked ? "authority-blocked" : retrying ? "retrying" : "paused";
      this.recovering.set(operation.key, { status, attempts,
        ...(retrying ? { nextRetryAt: Date.now() + retryDelay } : {}),
        code: blocked ? "PATH_DENIED" : "RECOVERY_REQUIRED",
        message: blocked ? "The prepared operation's Chat/workspace authority changed." : "Prepared archive delivery or journal completion failed.",
        action: blocked ? "Restore the original Chat/workspace authority, then retry design_commit with the original arguments. An expired Chat cannot publish this operation." :
          retrying ? "Wait for the bounded host retry; keep the original operation reference." :
            "Resolve the storage/delivery failure, enable Artifact, then retry design_commit with the original arguments. Reopening the application also resumes its saved journal." });
      this.clearRecoveryTimer(operation.key);
      if (retrying) {
        const timer = setTimeout(() => {
          this.recoveryTimers.delete(operation.key);
          if (this.closed) return;
          void this.queue.enqueue(async () => {
            const current = this.store.operation(operation.key);
            if (!this.closed && current?.state === "prepared") await this.resume(current);
          }).catch(() => undefined);
        }, retryDelay);
        timer.unref();
        this.recoveryTimers.set(operation.key, timer);
      }
      return this.pendingReceipt(operation);
    }
  }
  private clearRecoveryTimer(key: string) {
    clearTimeout(this.recoveryTimers.get(key)); this.recoveryTimers.delete(key);
  }
  private recoveryDetails(operation: DesignOperation) {
    const version = operation.revision;
    if (operation.conflict) return { ...this.conflictReceipt(operation), status: "source-conflict" as const, attempts: 0,
      action: "Keep the current source explicitly, then check and commit it. The original input and prepared archive are retained.",
      workspaceResume: operation.sourceEdit!.input };
    const state = this.recovering.get(operation.key) ?? { status: this.closed ? "paused" as const : "retrying" as const,
      attempts: 0, code: "RECOVERY_REQUIRED", message: "Prepared operation is waiting for its host.",
      action: this.closed ? "Reopen the application to resume the saved journal." : "Wait for the original prepared operation." };
    return { operationRef: operation.key, requestId: version.requestId, documentId: version.manifest.documentId,
      snapshotRef: version.snapshotRef, maxAttempts: RECOVERY_DELAYS.length + 1,
      ...state, ...(operation.sourceEdit ? { workspaceResume: operation.sourceEdit.input } : {}), resume: { path: version.path, requestId: version.requestId,
        expectedRevision: version.revision - 1, readSetDigest: version.readSetDigest } };
  }
  private pendingReceipt(operation: DesignOperation) {
    return { status: "pending" as const, requestId: operation.revision.requestId, operationRef: operation.key,
      code: "RECOVERY_REQUIRED", recovery: this.recoveryDetails(operation) };
  }
  private recoveryStatus(authority: DesignAuthority, documentId?: string) {
    return this.store.blocking().filter(operation => operation.revision.authority.chatId === authority.chatId &&
      operation.revision.authority.incarnationId === authority.incarnationId &&
      (!documentId || operation.revision.manifest.documentId === documentId)).slice(0, 64).map(operation => this.recoveryDetails(operation));
  }
  private async finish(operation: DesignOperation) {
    const data = await this.store.read(operation.revision.snapshotRef);
    this.assertAuthority(operation.revision.authority);
    if (operation.sourceEdit && !operation.sourceEdit.applied) {
      try {
        await applyPreparedDesignEdit(operation, data, () => this.assertAuthority(operation.revision.authority), (path, state) => this.store.sourceWrite(operation.key, path, state));
      } catch (cause) {
        if (!(cause instanceof DesignDocumentError) || cause.code !== "SOURCE_CHANGED") throw cause;
        const conflict = await this.store.sourceConflict(operation.key, cause.issues.map(issue => issue.file), cause.message);
        this.clearRecoveryTimer(operation.key); this.recovering.delete(operation.key);
        return conflict;
      }
      await this.store.sourceApplied(operation.key);
    }
    await this.ports.deliver(operation.revision, data);
    this.assertAuthority(operation.revision.authority);
    interruptionPoint("document-commit", "delivered");
    await this.store.complete(operation.key);
    this.clearRecoveryTimer(operation.key);
    this.recovering.delete(operation.key);
  }
  private conflictReceipt(operation: DesignOperation) {
    const writes = operation.sourceEdit!.writes, conflict = operation.conflict!;
    return { status: "conflict" as const, code: "SOURCE_CHANGED" as const, requestId: operation.revision.requestId, operationRef: operation.key,
      sourceConflict: { needsResolution: operation.state === "source-conflict", appliedCount: writes.filter(write => write.state === "applied").length,
        startedCount: writes.filter(write => write.state === "started").length, paths: conflict.paths.slice(0, 8), totalPaths: conflict.paths.length } };
  }
  list(chatId: string, incarnationId: string) {
    const authority = this.authority(chatId, incarnationId);
    return this.store.operations().filter(operation => operation.state === "complete" &&
      operation.revision.authority.ownerId === authority.ownerId && operation.revision.authority.chatId === chatId &&
      operation.revision.authority.incarnationId === incarnationId).map(operation => receipt(operation.revision));
  }
  async status(chatId: string, incarnationId: string) {
    const authority = this.authority(chatId, incarnationId);
    const latest = new Map<string, DesignRevision>();
    for (const operation of this.store.operations()) {
      const version = operation.revision;
      if (operation.state !== "complete" || version.authority.ownerId !== authority.ownerId ||
        version.authority.chatId !== chatId || version.authority.incarnationId !== incarnationId) continue;
      const previous = latest.get(version.manifest.documentId);
      if (!previous || previous.revision < version.revision) latest.set(version.manifest.documentId, version);
    }
    const documents = await Promise.all([...latest.values()].map(async version => {
      const current = await readDesignSet(authority.workspace, version.path).catch(() => null);
      return { ...receipt(version), ...this.store.navigation(authority, version.manifest.documentId), path: version.path, dirty: current?.readSetDigest !== version.readSetDigest };
    }));
    const root = join(await realpath(authority.workspace), "design");
    const safeRoot = await lstat(root).then(value => value.isDirectory() && !value.isSymbolicLink()).catch(() => false);
    const candidates = safeRoot ? (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory() &&
      /^[a-z0-9][a-z0-9_-]{0,63}$/.test(entry.name) && !latest.has(entry.name)).slice(0, 64).map(entry => `design/${entry.name}`) : [];
    this.assertAuthority(authority);
    return { documents, candidates, recovery: this.recoveryStatus(authority) };
  }
  async watch(chatId: string, incarnationId: string, changed: (status: Awaited<ReturnType<DesignDocuments["status"]>>) => void) {
    const authority = this.authority(chatId, incarnationId), root = join(await realpath(authority.workspace), "design");
    if (await realpath(root) !== root) throw new DesignDocumentError("PATH_DENIED", "Design watch root cannot contain symbolic links");
    let timer: ReturnType<typeof setTimeout> | undefined, closed = false;
    const watcher = watch(root, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => { void this.status(chatId, incarnationId).then(value => { if (!closed) changed(value); }).catch(() => undefined); }, 100);
    });
    watcher.on("error", () => { closed = true; watcher.close(); });
    return () => { closed = true; clearTimeout(timer); watcher.close(); };
  }
  async readRevision(chatId: string, incarnationId: string, documentId: string, revision: number) {
    const authority = this.authority(chatId, incarnationId);
    const version = this.store.versions(authority, documentId).find(value => value.revision === revision);
    if (!version) throw new DesignDocumentError("PATH_DENIED", "Document revision is not available to this Chat");
    const bytes = await this.store.read(version.snapshotRef);
    this.assertAuthority(authority);
    return { version, files: unpackArtifactArchive(bytes) };
  }
  private assertAuthority(authority: DesignAuthority) {
    const current = this.authority(authority.chatId, authority.incarnationId);
    if (JSON.stringify(current) !== JSON.stringify(authority)) throw new DesignDocumentError("PATH_DENIED", "Chat workspace authority changed");
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const key of this.recoveryTimers.keys()) this.clearRecoveryTimer(key);
    for (const value of this.recovering.values()) {
      value.status = "paused"; delete value.nextRetryAt;
      value.action = "Reopen the application to resume this prepared operation from its saved archive.";
    }
    this.queue.close(); await this.queue.flush(); await this.store.close();
  }
  async releaseChat(chatId: string, incarnationId: string) {
    return this.queue.enqueue(async () => {
      for (const operation of this.store.operations()) if (operation.revision.authority.chatId === chatId && operation.revision.authority.incarnationId === incarnationId) {
        this.clearRecoveryTimer(operation.key); this.recovering.delete(operation.key);
      }
      await this.store.releaseChat(chatId, incarnationId);
    });
  }
  fork(sourceChatId: string, sourceIncarnationId: string, chatId: string, incarnationId: string, artifactIds: readonly string[]) {
    const authority = this.authority(chatId, incarnationId);
    return this.queue.enqueue(async () => {
      this.assertAuthority(authority);
      for (const artifactId of new Set(artifactIds)) {
        const source = this.store.operations().find(operation => operation.revision.authority.chatId === sourceChatId &&
          operation.revision.authority.incarnationId === sourceIncarnationId && operation.revision.artifactId === artifactId);
        if (!source) continue;
        const key = requestKey(authority, "fork_" + designDigest(source.key).slice(7, 39));
        await this.store.alias({ key, parameterDigest: designDigest(JSON.stringify([authority, source.key, source.revision.snapshotRef])),
          state: "complete", revision: { ...source.revision, authority }, aliasOf: source.key });
      }
    });
  }
}

function receipt(revision: DesignRevision) {
  return { status: "committed" as const, documentId: revision.manifest.documentId, title: revision.manifest.title,
    fence: revision.fence,
    revision: revision.revision, requestId: revision.requestId, readSetDigest: revision.readSetDigest,
    snapshotRef: revision.snapshotRef, artifactRef: { chatId: revision.authority.chatId,
      incarnationId: revision.authority.incarnationId, artifactId: revision.artifactId } };
}
