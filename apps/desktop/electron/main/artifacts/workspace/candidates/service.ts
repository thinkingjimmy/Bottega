/**
 * [INPUT]: Main-authored native Skill-purpose guidance, original Chat selection, mounted-view custody, immutable snapshots and the existing document journal/gateway.
 * [OUTPUT]: NativeCandidates provides bounded isolated generation, per-consumer fixed preview identity, exact acceptance, existing-only prepared recovery and full-source AI rollback.
 * [POS]: Temporary task owner; prepared writes belong to the document journal and never depend on this registry surviving.
 */
import { nativeOperationReference } from "@ai-chat/cloud-protocol/artifacts/design/native/operation";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { packArtifactArchive, unpackArtifactArchive } from "@ai-chat/cloud-protocol/artifacts/archive";
import type { WorkspaceCommand } from "@ai-chat/cloud-protocol/artifacts/design/model";
import type { ChatTurnOptions } from "../../../../../shared/chat-agent/options";
import { SerialQueue } from "../../../persistence/serial-queue";
import { designDocuments } from "../../../design/documents/runtime";
import { designDigest, requestKey } from "../../../design/documents/model";
import { readDesignSet } from "../../../design/documents/read-set";
import { requireValidDesignSet } from "../../../design/documents/resources/validation";
import type { DesignRevision } from "../../../design/documents/store";
import { artifactRuntime } from "../../core/runtime";
import { nativeCandidatePrompt } from "../../../design/native/instructions";
import { assertArtifactGeneration } from "../../admission/state";

type Snapshot = { version: DesignRevision; files: { path: string; data: Uint8Array }[]; editable: boolean };
type Candidate = { id: string; requestId: string; parameters: string; input: WorkspaceCommand; windowId: number; version: DesignRevision;
  phase: "queued" | "generating" | "candidate" | "accepting" | "pending" | "committed" | "failed" | "cancelled";
  controller: AbortController; guard(): void; task?: Promise<void>; digest?: string; archive?: Uint8Array; readSetDigest?: string;
  manifest?: DesignRevision["manifest"]; error?: string; provider?: string; model?: string; answer?: string; receipt?: unknown;
  previews: Map<string, { id: string; url: string; ready: boolean; windowId: number; viewId: string }>; createdAt: number };
export class NativeCandidates {
  private readonly serial = new SerialQueue();
  private readonly records = new Map<string, Candidate>();
  private readonly started = new Map<string, Candidate>();
  private running = 0;
  constructor(private readonly root: string, private readonly optionsFor: (chatId: string, incarnationId: string) => ChatTurnOptions,
    private readonly ownsView: (input: WorkspaceCommand, windowId: number) => boolean) {}
  private key(input: WorkspaceCommand) { return JSON.stringify([input.chatId, input.incarnationId, input.documentId]); }
  private consumer(input: WorkspaceCommand, windowId: number) { return JSON.stringify([windowId, input.viewId]); }
  private releasePreviews(record: Candidate) {
    for (const preview of record.previews.values()) artifactRuntime()?.gateway.release(preview.id, preview.windowId);
    record.previews.clear();
  }
  private current(input: WorkspaceCommand, windowId: number, exact = true) {
    const record = this.records.get(this.key(input));
    if (!record || record.input.generation !== input.generation || !this.ownsView(input, windowId) ||
      exact && (record.id !== input.candidateId || record.digest !== input.candidateDigest)) throw new Error("Candidate updated. Review the new result before confirming.");
    record.guard(); this.sourceGuard(input, record.version, windowId)(); return record;
  }
  private status(record: Candidate, consumer: WorkspaceCommand = record.input) { return { candidateId: record.id, candidateDigest: record.digest, requestId: record.requestId,
    previewFile: record.manifest?.boards.find(board => board.id === record.manifest?.launchBoard)?.file, baseline: { artifactId: record.input.artifactId, documentId: record.input.documentId, viewId: consumer.viewId, generation: consumer.generation, expectedRevision: record.version.revision, readSetDigest: record.version.readSetDigest }, phase: record.phase, error: record.error, provider: record.provider, model: record.model, answer: record.answer, receipt: record.receipt }; }
  private sourceGuard(input: WorkspaceCommand, version: DesignRevision, windowId: number) {
    const lifetime = artifactRuntime()!.gateway.guard(windowId), documents = designDocuments();
    return () => {
      lifetime(); assertArtifactGeneration(input.generation);
      if (!this.ownsView(input, windowId) || JSON.stringify(documents.authority(input.chatId, input.incarnationId)) !== JSON.stringify(version.authority)) throw new Error("Candidate owner expired");
    };
  }
  private async baseline(input: WorkspaceCommand, version: DesignRevision) {
    const head = await designDocuments().currentHead(input.chatId, input.incarnationId, version.manifest.documentId);
    if (input.documentId !== version.manifest.documentId || head.revision !== input.expectedRevision || head.readSetDigest !== input.readSetDigest ||
      version.revision !== input.expectedRevision || version.readSetDigest !== input.readSetDigest || head.dirty || head.pending)
      throw new Error("The saved source changed. Your instructions are retained.");
  }
  recoverOperation(input: WorkspaceCommand, snapshot: Snapshot) {
    const reference = input.nativeOperation;
    if (!reference || !snapshot.editable || !snapshot.version.manifest.contentFormat || reference.documentId !== snapshot.version.manifest.documentId)
      throw new Error("Original native operation requires its owned source reference");
    const documents = designDocuments(), existing = documents.store.operation(requestKey(snapshot.version.authority, reference.requestId));
    if (!existing) return { status: "not-accepted", requestId: reference.requestId };
    const original = existing.sourceEdit?.input;
    if (!original || JSON.stringify(nativeOperationReference(original)) !== JSON.stringify(reference)) throw new Error("Original native operation parameters changed");
    return documents.operationStatus(original, true);
  }
  async dispatch(input: WorkspaceCommand, windowId: number, snapshot: Snapshot) {
    if (input.documentId !== snapshot.version.manifest.documentId) throw new Error("Candidate belongs to another document");
    if (!["canvas-dc/v3", "slides/v4"].includes(snapshot.version.manifest.contentFormat ?? "") || !snapshot.editable) throw new Error("Candidate editing requires the owned native source");
    const documents = designDocuments();
    if (["native-candidate-accept", "native-ai-rollback"].includes(input.action) && input.requestId) {
      const existing = documents.store.operation(requestKey(snapshot.version.authority, input.requestId));
      if (existing) {
        const original = existing.sourceEdit?.input;
        if (!original || original.action !== input.action || ["artifactId", "documentId", "expectedRevision", "readSetDigest", "candidateId", "candidateDigest", "rollbackOf"].some(key => original[key as keyof WorkspaceCommand] !== input[key as keyof WorkspaceCommand]))
          throw new Error("Candidate request was used with different parameters");
        return documents.operationStatus(original, true);
      }
    }
    if (input.action === "native-candidate-status") {
      const record = this.records.get(this.key(input));
      return record ? this.status(this.current(input, windowId, false), input) : { phase: "idle" };
    }
    return this.serial.enqueue(async () => {
      const guard = this.sourceGuard(input, snapshot.version, windowId); guard();
      if (input.action === "native-candidate") {
        const key = this.key(input), previous = this.records.get(key), parameters = designDigest(JSON.stringify(input));
        const request = requestKey(snapshot.version.authority, input.requestId!), known = this.started.get(request);
        if (known) { if (known.parameters !== parameters || known.windowId !== windowId) throw new Error("Candidate request parameters changed"); return this.status(known, input); }
        if (this.started.size >= 128) throw new Error("Candidate request budget reached. Reopen the workspace after current tasks finish.");
        await this.baseline(input, snapshot.version); guard();
        if (this.running >= 4 || this.records.size >= 32 && !previous) throw new Error("Candidate execution is busy. Retry after another task ends.");
        let files = snapshot.files;
        if (input.candidateId || input.candidateDigest) {
          const old = this.current(input, windowId); if (old.phase !== "candidate" || !old.archive) throw new Error("Candidate is not ready for another edit");
          if (old.version.readSetDigest !== snapshot.version.readSetDigest || old.version.revision !== snapshot.version.revision) throw new Error("The original source changed. Start a new candidate from the current source.");
          files = unpackArtifactArchive(old.archive, 512);
        }
        const selection = this.optionsFor(input.chatId, input.incarnationId);
        if (selection.backend !== "codex") throw new Error("This Provider does not support isolated candidate editing yet");
        if (previous) { previous.controller.abort(); previous.archive = undefined; if (!["accepting", "pending", "committed"].includes(previous.phase)) previous.phase = "cancelled"; } if (previous) this.releasePreviews(previous);
        const record: Candidate = { id: randomUUID(), requestId: input.requestId!, input, parameters, windowId, version: snapshot.version,
          controller: new AbortController(), guard, phase: "queued", previews: new Map(), createdAt: Date.now() };
        this.records.set(key, record); this.started.set(request, record); this.running++;
        record.task = this.generate(record, files, selection).finally(() => { this.running--; });
        return this.status(record, input);
      }
      if (input.action === "native-ai-rollback") {
        await this.baseline(input, snapshot.version); guard();
        const operation = documents.store.operation(requestKey(snapshot.version.authority, input.rollbackOf!)), original = operation?.sourceEdit?.input;
        if (operation?.state !== "complete" || operation.revision.requestId !== snapshot.version.requestId || original?.action !== "native-candidate-accept" || !original.baselineSnapshotRef)
          throw new Error("This AI rollback is no longer available");
        const files = unpackArtifactArchive(await documents.store.read(original.baselineSnapshotRef), 512); guard();
        return documents.edit(input, snapshot.version, async () => files, guard);
      }
      const record = this.current(input, windowId, input.action !== "native-candidate-cancel");
      if (input.action === "native-candidate-cancel") {
        if (record.id !== input.candidateId || record.requestId !== input.requestId || !["queued", "generating", "failed", "cancelled"].includes(record.phase)) throw new Error("Candidate stop belongs to an earlier task");
        record.controller.abort(); record.phase = "cancelled"; return this.status(record, input);
      }
      if (input.action === "native-candidate-discard") {
        if (["accepting", "pending", "committed"].includes(record.phase)) throw new Error("An accepted save belongs to its original operation");
        record.controller.abort(); record.phase = "cancelled"; record.archive = undefined;
        this.releasePreviews(record);
        return this.status(record, input);
      }
      if (record.phase !== "candidate" || !record.archive || !record.digest || !record.manifest) throw new Error("Candidate is not ready");
      if (input.action === "native-candidate-preview") {
        const key = this.consumer(input, windowId), previous = record.previews.get(key);
        if (previous) artifactRuntime()!.gateway.release(previous.id, windowId);
        const lease = await artifactRuntime()!.gateway.issueNative(input, windowId, { editable: false,
          version: { ...record.version, manifest: record.manifest, snapshotRef: record.digest, readSetDigest: record.readSetDigest! }, files: unpackArtifactArchive(record.archive, 512) });
        this.current(input, windowId); record.previews.set(key, { id: lease.id, url: lease.url, ready: false, windowId, viewId: input.viewId! }); return lease;
      }
      if (input.action === "native-candidate-ready") {
        const preview = record.previews.get(this.consumer(input, windowId));
        if (!preview || preview.id !== input.nonce || !artifactRuntime()!.gateway.allowsDocument(preview.url, windowId)) throw new Error("Candidate preview expired");
        preview.ready = true; return this.status(record, input);
      }
      const preview = record.previews.get(this.consumer(input, windowId));
      if (input.action !== "native-candidate-accept" || !preview?.ready || !artifactRuntime()!.gateway.allowsDocument(preview.url, windowId)) throw new Error("Review the rendered candidate before accepting");
      await this.baseline(input, snapshot.version); this.current(input, windowId);
      const archive = record.archive, fixed = { ...input, baselineSnapshotRef: snapshot.version.snapshotRef };
      record.phase = "accepting";
      try {
        const result = await documents.edit(fixed, snapshot.version, async () => unpackArtifactArchive(archive, 512), () => { guard(); if (this.records.get(this.key(input)) !== record) throw new Error("Candidate updated"); });
        record.receipt = result; record.phase = result.status === "committed" ? "committed" : "pending"; return result;
      } catch (cause) { record.phase = "candidate"; throw cause; }
    });
  }
  private async generate(record: Candidate, files: Snapshot["files"], selection: ChatTurnOptions) {
    let temporary: string | undefined, cleanup = true;
    try {
      await mkdir(this.root, { recursive: true }); temporary = await realpath(await mkdtemp(join(this.root, "candidate-")));
      const root = join(temporary, record.version.path); await mkdir(root, { recursive: true });
      const overlap = relative(record.version.authority.workspace, root);
      if (!overlap.startsWith("..")) throw new Error("Candidate directory overlaps the original workspace");
      for (const file of files) { const path = join(root, file.path); await mkdir(dirname(path), { recursive: true }); await writeFile(path, file.data, { flag: "wx" }); }
      record.guard(); record.controller.signal.throwIfAborted(); record.phase = "generating";
      const initial = await readDesignSet(temporary, record.version.path);
      const { runNativeCandidateJob } = await import("../../../design/native/candidate-job");
      const result = await runNativeCandidateJob({ chatId: record.input.chatId, incarnationId: record.input.incarnationId, requestId: record.requestId,
        root, options: selection, guard: record.guard, signal: record.controller.signal,
        prompt: nativeCandidatePrompt(record.input.value!) });
      record.guard(); record.controller.signal.throwIfAborted();
      const source = await readDesignSet(temporary, record.version.path), manifest = await requireValidDesignSet(source);
      if (manifest.contentFormat !== record.version.manifest.contentFormat) throw new Error("Candidate changed the document format");
      if (source.readSetDigest === initial.readSetDigest) throw new Error("The Provider produced no source changes. Your instructions are retained.");
      const archive = packArtifactArchive(source.files.map(file => ({ path: file.path, data: file.data })), 512);
      if (archive.length > 64 * 1024 * 1024 || [...this.records.values()].reduce((sum, row) => sum + (row.archive?.length ?? 0), 0) + archive.length > 128 * 1024 * 1024) throw new Error("Candidate retention budget exceeded");
      if (this.records.get(this.key(record.input)) !== record) return;
      record.archive = archive; record.digest = designDigest(archive); record.readSetDigest = source.readSetDigest; record.manifest = manifest;
      record.provider = result.provider; record.model = result.model; record.answer = result.answer.slice(0, 4096); record.phase = "candidate";
    } catch (cause) {
      cleanup = (cause as { code?: string }).code !== "ARTIFACT_CANDIDATE_CLEANUP_REQUIRED";
      record.phase = record.controller.signal.aborted ? "cancelled" : "failed"; record.error = cause instanceof Error ? cause.message.slice(0, 500) : "Candidate generation failed";
    } finally { if (temporary && cleanup) await rm(temporary, { recursive: true, force: true }).catch(() => {}); }
  }
  releaseView(input: WorkspaceCommand, windowId: number) {
    const key = this.key(input), record = this.records.get(key);
    if (!record) return;
    const consumer = this.consumer(input, windowId), preview = record.previews.get(consumer);
    if (preview) { artifactRuntime()?.gateway.release(preview.id, windowId); record.previews.delete(consumer); }
    if (record.windowId !== windowId || record.input.viewId !== input.viewId) return;
    if (!["accepting", "pending", "committed"].includes(record.phase)) record.controller.abort();
    this.releasePreviews(record); record.archive = undefined; this.records.delete(key);
  }
  stop(windowId?: number) {
    for (const record of this.records.values()) {
      for (const [key, preview] of record.previews) if (windowId === undefined || preview.windowId === windowId) {
        artifactRuntime()?.gateway.release(preview.id, preview.windowId); record.previews.delete(key);
      }
      if ((windowId === undefined || record.windowId === windowId) && !["accepting", "pending", "committed"].includes(record.phase)) {
        record.controller.abort(); record.archive = undefined; this.releasePreviews(record);
      }
    }
  }
  async close() { this.stop(); await Promise.all([...this.records.values()].map(record => record.task)); this.records.clear(); this.started.clear(); }
}
