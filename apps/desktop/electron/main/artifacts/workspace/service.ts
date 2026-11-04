/**
 * [INPUT]: Main document/Artifact custody, current Chat/workspace facts, the canonical Provider default, plugin lifecycle and trusted top-frame requests.
 * [OUTPUT]: Current native/system reads and exact-length native image bytes, saved system versions, source conflicts, mounted-view custody, request-start preview lifetime guards, isolated immutable candidates, existing-only prepared native recovery and journal-backed AI rollback/exports.
 * [POS]: Workspace authority; renderer input cannot select a filesystem root or App installation.
 */
import { readNativeComments } from "@ai-chat/cloud-protocol/artifacts/design/native/comments";
import { NativeCandidates } from "./candidates/service";
import { join } from "node:path";
import { requestKey } from "../../design/documents/model";
import type { ChatTurnOptions } from "../../../../shared/chat-agent/options";
import { readDesignManifest } from "@ai-chat/cloud-protocol/artifacts/design/core/source";
import { randomUUID } from "node:crypto";
import { DEFAULT_PROVIDER_ID } from "../../../../shared/providers/catalog";
import { workspaceCommandSchema, summarizeDesignBoards, type WorkspaceCommand } from "@ai-chat/cloud-protocol/artifacts/design/model";
import { designReferenceSchema, formatDesignReview, type DesignReference } from "@ai-chat/cloud-protocol/artifacts/design/review";
import { unpackArtifactArchive } from "@ai-chat/cloud-protocol/artifacts/archive";
import { designFrameHtml } from "@ai-chat/cloud-protocol/artifacts/design/frame";
import { designDocuments } from "../../design/documents/runtime";
import { prepareDesignSnapshot } from "../../design/documents/rendering";
import type { DesignRevision } from "../../design/documents/store";
import { BrowserWindow, dialog } from "electron";
import { writeFile } from "node:fs/promises";
import { artifactRuntime } from "../core/runtime";
import { artifactEnabled, artifactGeneration, assertArtifactGeneration, assertArtifactAdmission } from "../admission/state";
import { ArtifactCheckpoints } from "./checkpoints";
import { artifactExecutionState } from "@ai-chat/cloud-protocol/artifacts/design/capability";
import { PROTOCOL_VERSION } from "@ai-chat/cloud-protocol/config";
import type { RemoteArtifactWorkspace } from "./remote";
export class ArtifactWorkspace {
  readonly checkpoints: ArtifactCheckpoints;
  readonly candidates: NativeCandidates;
  remote: RemoteArtifactWorkspace | undefined;
  constructor(root: string, optionsFor: (chatId: string, incarnationId: string) => ChatTurnOptions = () => { throw new Error("Original Chat selection is unavailable"); }) {
    this.checkpoints = new ArtifactCheckpoints(root);
    this.candidates = new NativeCandidates(join(root, "candidates"), optionsFor, (input, windowId) => this.checkpoints.ownsView(windowId, input.viewId!, this.checkpoints.key(input.chatId, input.incarnationId, input.documentId!)));
  }
  initialize() { return this.checkpoints.initialize(); }
  async authorizeReference(chatId: string, incarnationId: string, value: DesignReference) {
    const reference = designReferenceSchema.parse(value);
    const snapshot = await this.version({ action: "read", chatId, incarnationId, artifactId: reference.artifactId });
    if (snapshot.version.manifest.documentId !== reference.documentId || snapshot.version.revision !== reference.revision || snapshot.version.readSetDigest !== reference.readSetDigest) throw new Error("Design reference changed");
    if (reference.native) await (await import("../../design/chat-edit/evidence")).assertNativeEvidence(reference, snapshot.files);
    await this.assertExecution({ action: "reference-check", chatId, incarnationId, artifactId: reference.artifactId, generation: reference.generation }, snapshot.remote); return snapshot;
  }
  async identity(input: WorkspaceCommand) {
    if (!input.artifactId) throw new Error("A committed Artifact reference is required");
    const ref = { chatId: input.chatId, incarnationId: input.incarnationId, artifactId: input.artifactId };
    const artifacts = artifactRuntime()!;
    const record = await artifacts.metadata(ref);
    if (!record?.fence.design) throw new Error("Artifact snapshot is unavailable");
    return { summary: record.fence.design, remote: Boolean(record.remote) };
  }
  async version(input: WorkspaceCommand) {
    const documents = designDocuments();
    if (!input.artifactId) throw new Error("A committed Artifact reference is required");
    const source = await artifactRuntime()!.resolve({ chatId: input.chatId, incarnationId: input.incarnationId, artifactId: input.artifactId });
    if (!source.record.fence.design) throw new Error("This Artifact has no design document");
    const summary = source.record.fence.design;
    let authority: DesignRevision["authority"] | null = null;
    if (!source.record.remote) { try { authority = documents.authority(input.chatId, input.incarnationId); } catch { /* Retained bytes grant no working-source authority. */ } }
    const selected = authority ? documents.store.revision(authority, summary.documentId, summary.revision) : null;
    const local = selected?.artifactId === input.artifactId && selected.snapshotRef === summary.snapshotRef ? selected : undefined;
    const files = unpackArtifactArchive(source.data, 512), manifest = readDesignManifest(files, summary.documentId);
    if (manifest.contentFormat !== summary.contentFormat) throw new Error("Artifact source format does not match its fixed summary");
    if (manifest.documentId !== summary.documentId || JSON.stringify(summarizeDesignBoards(manifest)) !== JSON.stringify(summary.boards) ||
      (manifest.contentFormat === "slides/v4" && summary.boardCount !== manifest.boards.length) ||
      authority && JSON.stringify(documents.authority(input.chatId, input.incarnationId)) !== JSON.stringify(authority)) throw new Error("Artifact reference authority changed");
    const version: DesignRevision = local ?? { authority: authority ?? { chatId: input.chatId, incarnationId: input.incarnationId, workspace: "", ownerId: "retained:" + input.chatId, authorityIdentity: source.record.remote ?? input.incarnationId }, manifest, path: `${manifest.format === "bottega-design-system" ? "design-systems" : "design"}/${manifest.documentId}`,
      revision: summary.revision, readSetDigest: summary.readSetDigest, snapshotRef: summary.snapshotRef, artifactId: input.artifactId,
      fence: source.record.fence, messageId: source.record.messageId, backend: DEFAULT_PROVIDER_ID, requestId: "retained-reference", createdAt: source.record.fence.createdAt ?? 0 };
    await artifactRuntime()!.validate(source.record.ref);
    return { version, files, editable: Boolean(local) && !documents.store.unsupportedBlocks(version.authority, manifest.documentId), remote: Boolean(source.record.remote) };
  }
  private async assertExecution(input: WorkspaceCommand, remote: boolean) {
    if (!remote) { assertArtifactGeneration(input.generation); return; }
    if (!this.remote) throw new Error("artifact-offline");
    const target = await this.remote.capability(input);
    const answer = await this.remote.execute(input, "artifact-status", { chatId: input.chatId, incarnationId: input.incarnationId, cursor: null });
    const state = artifactExecutionState({ online: target.online, protocolVersion: target.protocolVersion, capability: answer.ok ? answer.artifactStatus?.capability ?? null : null, now: Date.now(), requiredProtocol: PROTOCOL_VERSION });
    if (state !== "ready") throw new Error("artifact-" + state);
    if (answer.ok && input.generation !== answer.artifactStatus?.capability.generation) throw new Error("artifact-generation-expired");
  }
  private async saveExport(input: WorkspaceCommand, windowId: number, result: { data: string; filename: string; [key: string]: unknown }, guard: () => void = () => {}) {
    if (!input.save) return result;
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.id === windowId);
    if (!window || window.isDestroyed()) throw new Error("Original export window is unavailable");
    guard(); const destination = await dialog.showSaveDialog(window, { defaultPath: result.filename });
    if (!destination.canceled && destination.filePath) { guard(); await this.version(input); await writeFile(destination.filePath, Buffer.from(result.data, "base64")); }
    return { ...result, data: undefined, canceled: destination.canceled };
  }
  async dispatch(raw: unknown, windowId = 0, backend: string = DEFAULT_PROVIDER_ID): Promise<unknown> {
    const input = workspaceCommandSchema.parse(raw), documents = designDocuments();
    const previewGuard = input.action === "preview" ? artifactRuntime()!.gateway.guard(windowId) : undefined;
    if (["capture-status", "retry-capture"].includes(input.action)) {
      const ref = { chatId: input.chatId, incarnationId: input.incarnationId, artifactId: input.artifactId! };
      if (!artifactRuntime()!.ownsChat(ref)) {
        if (!this.remote) throw new Error("artifact-offline");
        const answer = await this.remote.execute(input, "artifact-workspace", input);
        if (!answer.ok || !answer.artifactRecovery) throw new Error("artifact-unavailable");
        if (answer.artifactRecovery.fence?.sha256) artifactRuntime()!.remote!.rememberRecovery(ref, answer.artifactRecovery.fence);
        return answer.artifactRecovery;
      }
      return { fence: input.action === "capture-status" ? artifactRuntime()!.captureStatus(ref) : await artifactRuntime()!.retryCapture(ref) };
    }
    if (input.action === "reference-check") { await this.authorizeReference(input.chatId, input.incarnationId, designReferenceSchema.parse(input.reference)); return { available: true }; }
    if (input.action === "ack-disable") { this.checkpoints.ack(windowId, input.nonce!, input.viewId!, this.checkpoints.key(input.chatId, input.incarnationId, input.documentId!)); return { acknowledged: true }; }
    if (input.action === "release-view") { this.candidates.releaseView(input, windowId); this.checkpoints.releaseView(windowId, input.viewId!, this.checkpoints.key(input.chatId, input.incarnationId, input.documentId!)); return { released: true }; }
    if (input.action === "list") {
      try { return { ...await documents.status(input.chatId, input.incarnationId), generation: artifactGeneration(), enabled: artifactEnabled() }; }
      catch (cause) {
        if (!this.remote) throw cause;
        const answer = await this.remote.execute(input, "artifact-status", { chatId: input.chatId, incarnationId: input.incarnationId, cursor: null });
        if (!answer.ok || !answer.artifactStatus) throw cause;
        let page = answer.artifactStatus;
        const documents = [...page.documents], generation = page.capability.generation, cursors = new Set<string>();
        for (let count = 1; page.cursor && count < 512; count++) {
          if (cursors.has(page.cursor)) throw new Error("artifact-status-cursor-repeated");
          cursors.add(page.cursor);
          const next = await this.remote.execute(input, "artifact-status", { chatId: input.chatId, incarnationId: input.incarnationId, cursor: page.cursor });
          if (!next.ok || !next.artifactStatus || next.artifactStatus.capability.generation !== generation) throw new Error("artifact-status-incomplete");
          page = next.artifactStatus; documents.push(...page.documents);
        }
        return { generation, enabled: page.capability.enabled, statusComplete: !page.cursor,
          documents: documents.map(value => ({ ...value, artifactRef: { artifactId: value.artifactId } })) };
      }
    }
    if (input.action === "system-extract") {
      assertArtifactGeneration(input.generation);
      return (await import("../../design/systems/service")).extractDesignSystem(input, backend);
    }
    if (input.action === "cancel-thumbnail") return (await import("./thumbnails")).cancelThumbnailRequest(input, windowId);
    if (input.action === "thumbnail") {
      const thumbnails = await import("./thumbnails");
      return thumbnails.withThumbnailRequest(input, windowId, async signal => {
        const identity = await this.identity(input);
        signal.throwIfAborted();
        if (!identity.remote) return thumbnails.designThumbnail(input, this, signal);
        if (!this.remote) throw new Error("artifact-offline");
        const remote = this.remote, cancel = () => { void remote.execute({ ...input, action: "cancel-thumbnail" }, "artifact-workspace", { ...input, action: "cancel-thumbnail" }).catch(() => {}); };
        signal.addEventListener("abort", cancel, { once: true });
        try {
          const answer = await remote.execute(input, "artifact-workspace", input); signal.throwIfAborted();
          if (!answer.ok) throw new Error(answer.code);
          if (!answer.artifactExport) throw new Error("artifact-unavailable");
          const data = await artifactRuntime()!.publisher.download({ chatId: input.chatId, incarnationId: input.incarnationId, artifactId: answer.artifactExport.fence.id }, answer.artifactExport.fence, AbortSignal.any([signal, AbortSignal.timeout(60_000)]));
          await this.identity(input); signal.throwIfAborted();
          return { ...answer.artifactExport, mime: answer.artifactExport.fence.mime, data: Buffer.from(data).toString("base64") };
        } finally { signal.removeEventListener("abort", cancel); }
      });
    }
    if (input.action === "native-project-choose" || input.action === "native-project-import") return (await import("../../design/projects/jobs/owner")).withProjectWork(async () => {
      const current = () => { assertArtifactGeneration(input.generation); assertArtifactAdmission(); };
      current(); const authority = documents.authority(input.chatId, input.incarnationId), original = documents.store.operation(requestKey(authority, input.requestId!));
      if (original?.importCount) {
        const sourceDigest = original.sourceEdit?.input.sourceDigest;
        if (!sourceDigest || input.sourceDigest && input.sourceDigest !== sourceDigest) throw new Error("The original project import has different fixed bytes");
        return documents.importProject({ ...input, action: "native-project-import", sourceDigest }, async () => { throw new Error("The original prepared import must resume its existing journal"); }, current);
      }
      let bytes: Uint8Array;
      if (input.action === "native-project-choose") {
        const window = BrowserWindow.getAllWindows().find(window => window.webContents.id === windowId);
        if (!window || window.isDestroyed()) throw new Error("The original project import window is unavailable");
        const selected = await dialog.showOpenDialog(window, { properties: ["openFile"], filters: [{ name: "Artifact project ZIP", extensions: ["zip"] }] });
        current(); if (window.isDestroyed()) throw new Error("The original project import window closed");
        if (selected.canceled || selected.filePaths.length !== 1) return { canceled: true };
        bytes = await (await import("../../design/projects/source")).readProjectFile(selected.filePaths[0]!, AbortSignal.timeout(60000));
      } else {
        if (!input.projectFileId) throw new Error("Select one immutable project ZIP");
        const source = await artifactRuntime()!.resolve({ chatId: input.chatId, incarnationId: input.incarnationId, artifactId: input.projectFileId });
        if (source.record.fence.mime !== "application/zip" && !/\.zip$/i.test(source.record.fence.title)) throw new Error("Select a complete project ZIP"); bytes = source.data;
      }
      current(); const sourceDigest = (await import("../../design/documents/model")).designDigest(bytes);
      if (input.sourceDigest && input.sourceDigest !== sourceDigest) throw new Error("The selected project ZIP changed");
      return (await import("../../design/projects/import")).importProjectBytes({ ...input, action: "native-project-import", sourceDigest }, bytes, current);
    });
    if (input.action === "native-download") return artifactRuntime()!.gateway.saveNativeDownload(input, windowId, (result, guard) => this.saveExport({ ...input, save: true }, windowId, result, guard));
    const snapshot = await this.version(input), version = snapshot.version;
    if (input.action === "native-locate") {
      const reference = designReferenceSchema.parse(input.reference);
      await this.authorizeReference(input.chatId, input.incarnationId, reference);
      if (reference.documentId !== version.manifest.documentId) throw new Error("Native target belongs to another work");
      const head = await this.dispatch({ ...input, action: "native-head", reference: undefined }, windowId, backend) as import("@ai-chat/cloud-protocol/artifacts/design/model").WorkspaceRead;
      const current = await this.version({ ...input, action: "read", artifactId: head.fence!.id });
      if (reference.native && (await import("../../design/chat-edit/targets")).nativeTargetDigest(current.files, reference.native.file, reference.native.anchor) !== reference.native.sourceDigest) throw new Error("This target changed. Open History to inspect its original version.");
      return head;
    }
    if (input.action === "native-reference") {
      if (snapshot.remote) {
        if (!this.remote) throw new Error("artifact-offline");
        const answer = await this.remote.execute(input, "artifact-workspace", input);
        if (!answer.ok || !answer.artifactNativeReference) throw new Error(answer.ok ? "artifact-unavailable" : answer.code);
        return answer.artifactNativeReference;
      }
      return (await import("../../design/chat-edit/evidence")).nativeReference(input, snapshot);
    }
    if (input.action.startsWith("native-history-")) {
      if (snapshot.remote) {
        if (!this.remote) throw new Error("artifact-offline");
        if (input.action === "native-history-restore") await this.assertExecution(input, true);
        const answer = await this.remote.execute(input, "artifact-workspace", input);
        if (!answer.ok) throw new Error(answer.code);
        return answer.artifactNativeHistory ?? answer.artifactOperation;
      }
      return (await import("../../design/history/service")).nativeHistoryAction(documents, input, version, () => assertArtifactGeneration(input.generation));
    }
    if (input.action.startsWith("native-candidate") || input.action === "native-ai-rollback") {
      if (snapshot.remote) throw new Error("Native remote candidate transport is not available yet");
      return this.candidates.dispatch(input, windowId, snapshot);
    }
    if (input.action === "native-head") {
      if ((!version.manifest.contentFormat && !version.manifest.system) || snapshot.remote) throw new Error("Native current head is unavailable on this path");
      const head = await documents.currentHead(input.chatId, input.incarnationId, version.manifest.documentId);
      const headSnapshot = await this.version({ ...input, action: "read", artifactId: head.artifactRef.artifactId }), current = headSnapshot.version;
      const accepted = documents.store.operation(requestKey(current.authority, current.requestId))?.sourceEdit?.input;
      const aiRollback = ["native-candidate-accept", "native-chat-apply"].includes(accepted?.action ?? "") && accepted?.baselineSnapshotRef ? { requestId: current.requestId } : undefined;
      const pending = documents.store.blocking().find(operation => operation.revision.authority.chatId === current.authority.chatId && operation.revision.authority.incarnationId === current.authority.incarnationId && operation.revision.manifest.documentId === current.manifest.documentId && operation.sourceEdit?.input.action === "native-chat-apply");
      const pendingChatEdit = pending?.sourceEdit?.input.artifactId ? { artifactId: pending.sourceEdit.input.artifactId, requestId: pending.revision.requestId } : undefined;
      return { nativeComments: readNativeComments(headSnapshot.files), aiRollback, pendingChatEdit, documentId: current.manifest.documentId, title: current.manifest.title, manifest: current.manifest, fence: current.fence,
        revision: current.revision, latestRevision: current.revision, readSetDigest: current.readSetDigest, snapshotRef: current.snapshotRef,
        generation: artifactGeneration(), enabled: artifactEnabled(), editable: headSnapshot.editable && artifactEnabled(), dirty: head.dirty || head.pending, statusComplete: true, historyComplete: true,
        previewEnabled: artifactEnabled(),
        checkpoint: this.checkpoints.native(input.chatId, input.incarnationId, current.manifest.documentId, current.revision, current.manifest.launchBoard),
        versions: [{ revision: current.revision, artifactId: current.artifactId, createdAt: current.createdAt }] };
    }
    if (input.action === "native-editor") {
      if (snapshot.remote) throw new Error("Native remote editor transport is not available yet");
      assertArtifactGeneration(input.generation);
      if (input.expectedRevision !== version.revision || input.readSetDigest !== version.readSetDigest) throw new Error("Native editor source identity changed");
      return artifactRuntime()!.gateway.issueNative(input, windowId, snapshot);
    }
    if (input.action === "acquire-view") {
      assertArtifactAdmission();
      if (input.documentId !== version.manifest.documentId) throw new Error("Workspace view belongs to another document");
      this.checkpoints.observe(windowId, input.viewId!, this.checkpoints.key(input.chatId, input.incarnationId, version.manifest.documentId));
      return { acquired: true };
    }
    if (input.action === "checkpoint") {
      if (!snapshot.remote && input.generation !== artifactGeneration()) throw new Error("ARTIFACT_GENERATION_EXPIRED: Reopen the current workspace");
      if (!input.checkpoint || input.checkpoint.documentId !== version.manifest.documentId || input.checkpoint.revision !== version.revision ||
        !version.manifest.boards.some(board => board.id === input.checkpoint!.boardId)) throw new Error("Checkpoint belongs to another version");
      const checkpointVersion = await this.checkpoints.save(input.chatId, input.incarnationId, input.checkpoint); return { saved: true, checkpointVersion };
    }
    if (input.action === "read") {
      const native = Boolean(version.manifest.contentFormat || version.manifest.system);
      const versions = native ? [] : documents.store.versions(version.authority, version.manifest.documentId);
      let live: { revision: number; dirty: boolean } | undefined, generation = artifactGeneration(), enabled = artifactEnabled();
      let statusComplete = !snapshot.remote, historyComplete = !snapshot.remote;
      let history = versions.map(value => ({ revision: value.revision, artifactId: value.artifactId, createdAt: value.createdAt }));
      if (snapshot.remote && this.remote) {
        enabled = false; generation = "unknown";
        try {
          const target = await this.remote.capability(input), answer = await this.remote.execute(input, "artifact-status", { chatId: input.chatId, incarnationId: input.incarnationId, cursor: null });
          if (answer.ok && answer.artifactStatus) { generation = answer.artifactStatus.capability.generation;
            enabled = artifactEnabled() && artifactExecutionState({ online: target.online, protocolVersion: target.protocolVersion, capability: answer.artifactStatus.capability, now: Date.now(), requiredProtocol: PROTOCOL_VERSION }) === "ready";
            let page = answer.artifactStatus, pages = 0;
            const cursors = new Set<string>();
            while (true) {
              live ??= page.documents.find(value => value.documentId === version.manifest.documentId);
              if (!page.cursor) { statusComplete = true; break; }
              if (++pages >= 512 || cursors.has(page.cursor)) break;
              cursors.add(page.cursor);
              const next = await this.remote.execute(input, "artifact-status", { chatId: input.chatId, incarnationId: input.incarnationId, cursor: page.cursor });
              if (!next.ok || !next.artifactStatus || next.artifactStatus.capability.generation !== generation) break;
              page = next.artifactStatus;
            }
          }
          let cursor = 0; history = [];
          const cursors = new Set<number>();
          for (let page = 0; page < 512; page++) { const answer = await this.remote.execute(input, "artifact-history", { chatId: input.chatId, incarnationId: input.incarnationId, artifactId: input.artifactId, cursor });
            if (!answer.ok || !answer.artifactHistory) break;
            history.push(...answer.artifactHistory.versions.map(value => ({ revision: value.revision, artifactId: value.artifactId, createdAt: 0 })));
            if (!answer.artifactHistory.cursor) { historyComplete = true; break; }
            if (cursors.has(answer.artifactHistory.cursor)) break; cursor = answer.artifactHistory.cursor; cursors.add(cursor);
          }
        } catch { /* Offline reading preserves frozen snapshots and recovery input. */ }
      } else { try {
        if (native) { const head = await documents.currentHead(input.chatId, input.incarnationId, version.manifest.documentId); live = { revision: head.revision, dirty: head.dirty || head.pending }; }
        else live = (await documents.status(input.chatId, input.incarnationId)).documents.find(value => value.documentId === version.manifest.documentId);
      } catch { enabled = false; } }
      return { documentId: version.manifest.documentId, title: version.manifest.title, manifest: version.manifest, editable: snapshot.remote ? true : snapshot.editable,
        ...(native ? { nativeComments: readNativeComments(snapshot.files) } : {}),
        fence: version.fence,
        revision: version.revision, latestRevision: Math.max(live?.revision ?? 0, history.at(-1)?.revision ?? 0, version.revision), readSetDigest: version.readSetDigest, snapshotRef: version.snapshotRef,
        generation, enabled: enabled && statusComplete && historyComplete, statusComplete, historyComplete, previewEnabled: artifactEnabled(), dirty: live?.dirty ?? true,
        checkpoint: this.checkpoints.read(input.chatId, input.incarnationId, version.manifest.documentId, version.revision),
        checkpointConflicts: this.checkpoints.conflicts(input.chatId, input.incarnationId, version.manifest.documentId, version.revision),
        versions: history.length ? history : [{ revision: version.revision, artifactId: version.artifactId, createdAt: version.createdAt }],
        ...(version.manifest.system ? { system: Object.fromEntries(snapshot.files.filter(file => Object.values(version.manifest.system!).includes(file.path)).map(file =>
          [Object.entries(version.manifest.system!).find(([, path]) => path === file.path)![0], JSON.parse(new TextDecoder("utf-8", { ignoreBOM: true }).decode(file.data))])) } : {}) };
    }
    if (input.action === "archive") return { data: (await artifactRuntime()!.resolve({ chatId: input.chatId, incarnationId: input.incarnationId, artifactId: version.artifactId })).data.toString("base64"), snapshotRef: version.snapshotRef };
    if (snapshot.remote && !["preview", "review"].includes(input.action)) {
      if (!this.remote) throw new Error("artifact-offline");
      if (!["operation-status", "thumbnail"].includes(input.action)) await this.assertExecution(input, true);
      const { save: _save, ...remoteInput } = input;
      const answer = await this.remote.execute(input, input.action === "operation-status" ? "artifact-operation-status" : "artifact-workspace",
        input.action === "operation-status" ? { action: input.action, chatId: input.chatId, incarnationId: input.incarnationId, artifactId: input.artifactId, requestId: input.requestId } : remoteInput);
      if (!answer.ok) throw new Error(answer.code);
      if (answer.artifactExport) { const result = answer.artifactExport;
        const data = await artifactRuntime()!.publisher.download({ chatId: input.chatId, incarnationId: input.incarnationId, artifactId: result.fence.id }, result.fence, AbortSignal.timeout(60_000));
        return this.saveExport(input, windowId, { ...result, mime: result.fence.mime, data: Buffer.from(data).toString("base64") });
      }
      return answer.artifactDifference ?? answer.artifactOperation;
    }
    if (input.action === "operation-status") return input.nativeOperation ? this.candidates.recoverOperation(input, snapshot) : documents.operationStatus({ ...input, documentId: version.manifest.documentId });
    if (input.action === "export") {
      assertArtifactGeneration(input.generation);
      const result = await (await import("../../design/editing/export")).exportDesignRevision(input, snapshot);
      return this.saveExport(input, windowId, result);
    }
    if (input.action !== "preview") await this.assertExecution(input, snapshot.remote);
    if (input.action === "resume-edit") return documents.operationStatus({ ...input, documentId: version.manifest.documentId }, true);
    if (input.action === "resolve-edit") return documents.resolveConflict({ ...input, documentId: version.manifest.documentId }, () => assertArtifactGeneration(input.generation));
    if (input.action === "review") {
      if (!input.checkpoint || input.checkpoint.documentId !== version.manifest.documentId || input.checkpoint.revision !== version.revision) throw new Error("Review belongs to another version");
      const { resolveDesignAnchor } = await import("@ai-chat/cloud-protocol/artifacts/design/core/anchors");
      const notes = input.checkpoint.notes.map(note => {
        if (!note.anchor) return note;
        const board = version.manifest.boards.find(board => board.id === note.anchor!.boardId), file = snapshot.files.find(file => file.path === board?.file);
        if (!file) throw new Error("Review target is missing");
        return { ...note, anchor: { ...resolveDesignAnchor(new TextDecoder("utf-8", { ignoreBOM: true }).decode(file.data), note.anchor, true).anchor, file: board!.file } };
      });
      const value = { ...input.checkpoint, notes }, checkpointVersion = await this.checkpoints.save(input.chatId, input.incarnationId, value);
      const checkpoint = { ...value, ...(value.save ? { save: { ...value.save, version: checkpointVersion! } } : {}) };
      return { prompt: formatDesignReview(checkpoint, version.readSetDigest), checkpoint, title: version.manifest.title,
        design: { artifactId: version.artifactId, documentId: version.manifest.documentId, revision: version.revision, readSetDigest: version.readSetDigest, generation: input.generation,
          anchors: Object.fromEntries(notes.map((note, index) => [String(index + 1), note.anchor])) } };
    }
    if (input.action.startsWith("system-")) return (await import("../../design/systems/service")).designSystemAction(input, snapshot);
    if (input.action === "preview") {
      previewGuard!();
      if (version.manifest.system && input.scope !== "board" || input.systemId) {
        let fixed = snapshot;
        if (input.systemId) {
          const captured = (await import("../../design/systems/native/browse")).fixedSystemSnapshot(version.manifest, snapshot.files, input.systemId);
          fixed = { ...snapshot, files: captured.files, version: { ...version, ...captured.version, readSetDigest: captured.version.snapshotRef }, editable: false };
        }
        const lease = await artifactRuntime()!.gateway.issueNative(input, windowId, { ...fixed, editable: false }, { preview: true });
        try { previewGuard!(); return { ...lease, viewport: { width: 1100, height: 850 } }; }
        catch (cause) { artifactRuntime()!.gateway.release(lease.id, windowId); throw cause; }
      }
      const prepared = await prepareDesignSnapshot(snapshot, input.boardId);
      previewGuard!();
      if (snapshot.remote) assertArtifactAdmission(); else assertArtifactGeneration(input.generation);
      const nonce = randomUUID(), id = randomUUID();
      const html = designFrameHtml(prepared.html.toString("utf8"), { id, nonce, generation: input.generation!, boardId: prepared.metadata.boardId, boardDigest: prepared.metadata.boardDigest, navigation: prepared.metadata.navigation }, (prepared.metadata.contentFormat === "canvas-dc/v3" || prepared.metadata.contentFormat === "slides/v4"));
      const gateway = artifactRuntime()!.gateway;
      const lease = await gateway.issuePrepared({ chatId: input.chatId, incarnationId: input.incarnationId, artifactId: version.artifactId }, windowId, id, html, prepared.metadata.contentFormat);
      try { previewGuard!(); return { ...lease, nonce, generation: input.generation, ...prepared.metadata }; }
      catch (cause) { gateway.release(lease.id, windowId); throw cause; }
    }
    throw new Error("This workspace action is not available");
  }
}
