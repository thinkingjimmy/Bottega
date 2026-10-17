/**
 * [INPUT]: Main document/Artifact custody, current Chat/workspace facts, plugin lifecycle and trusted top-frame requests.
 * [OUTPUT]: Fixed Canvas reads/capabilities/batches, semantic history, source conflicts, mounted-view checkpoint custody and immutable exports.
 * [POS]: Workspace authority; renderer input cannot select a filesystem root or App installation.
 */
import { randomUUID } from "node:crypto";
import { manifestSchema, workspaceCommandSchema, summarizeDesignBoards, type WorkspaceCommand } from "@ai-chat/cloud-protocol/artifacts/design/model";
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
import { readCanvas, validateCanvasCheckpoint } from "@ai-chat/cloud-protocol/artifacts/design/canvas/view";
export class ArtifactWorkspace {
  readonly checkpoints: ArtifactCheckpoints;
  remote: RemoteArtifactWorkspace | undefined;
  constructor(root: string) { this.checkpoints = new ArtifactCheckpoints(root); }
  initialize() { return this.checkpoints.initialize(); }
  async authorizeReference(chatId: string, incarnationId: string, value: DesignReference) {
    const reference = designReferenceSchema.parse(value);
    const snapshot = await this.version({ action: "read", chatId, incarnationId, artifactId: reference.artifactId });
    if (snapshot.version.manifest.documentId !== reference.documentId || snapshot.version.revision !== reference.revision || snapshot.version.readSetDigest !== reference.readSetDigest) throw new Error("Design reference changed");
    await this.assertExecution({ action: "reference-check", chatId, incarnationId, artifactId: reference.artifactId, generation: reference.generation }, snapshot.remote); return snapshot;
  }
  async version(input: WorkspaceCommand) {
    const documents = designDocuments();
    if (!input.artifactId) throw new Error("A committed Artifact reference is required");
    const source = await artifactRuntime()!.resolve({ chatId: input.chatId, incarnationId: input.incarnationId, artifactId: input.artifactId });
    if (!source.record.fence.design) throw new Error("This Artifact has no design document");
    const summary = source.record.fence.design;
    let authority: DesignRevision["authority"] | null = null;
    if (!source.record.remote) { try { authority = documents.authority(input.chatId, input.incarnationId); } catch { /* Retained bytes grant no working-source authority. */ } }
    const local = authority ? documents.store.versions(authority, summary.documentId).find(version => version.artifactId === input.artifactId && version.snapshotRef === summary.snapshotRef) : undefined;
    const files = unpackArtifactArchive(source.data), manifest = manifestSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(files.find(file => file.path === "canvas.json")!.data)));
    if (manifest.documentId !== summary.documentId || JSON.stringify(summarizeDesignBoards(manifest)) !== JSON.stringify(summary.boards) ||
      authority && JSON.stringify(documents.authority(input.chatId, input.incarnationId)) !== JSON.stringify(authority)) throw new Error("Artifact reference authority changed");
    const version: DesignRevision = local ?? { authority: authority ?? { chatId: input.chatId, incarnationId: input.incarnationId, workspace: "", ownerId: "retained:" + input.chatId, authorityIdentity: source.record.remote ?? input.incarnationId }, manifest, path: `${manifest.format === "bottega-design-system" ? "design-systems" : "design"}/${manifest.documentId}`,
      revision: summary.revision, readSetDigest: summary.readSetDigest, snapshotRef: summary.snapshotRef, artifactId: input.artifactId,
      fence: source.record.fence, messageId: source.record.messageId, backend: "codex", requestId: "retained-reference", createdAt: source.record.fence.createdAt ?? 0 };
    await artifactRuntime()!.validate(source.record.ref);
    return { version, files, editable: Boolean(local), remote: Boolean(source.record.remote) };
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
  private async saveExport(input: WorkspaceCommand, windowId: number, result: { data: string; filename: string; [key: string]: unknown }) {
    if (!input.save) return result;
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.id === windowId);
    if (!window || window.isDestroyed()) throw new Error("Original export window is unavailable");
    const destination = await dialog.showSaveDialog(window, { defaultPath: result.filename });
    if (!destination.canceled && destination.filePath) { await this.version(input); await writeFile(destination.filePath, Buffer.from(result.data, "base64")); }
    return { ...result, data: undefined, canceled: destination.canceled };
  }
  async dispatch(raw: unknown, windowId = 0, backend = "codex"): Promise<unknown> {
    const input = workspaceCommandSchema.parse(raw), documents = designDocuments();
    if (input.action === "reference-check") { await this.authorizeReference(input.chatId, input.incarnationId, designReferenceSchema.parse(input.reference)); return { available: true }; }
    if (input.action === "ack-disable") { this.checkpoints.ack(windowId, input.nonce!, input.viewId!, this.checkpoints.key(input.chatId, input.incarnationId, input.documentId!)); return { acknowledged: true }; }
    if (input.action === "release-view") { this.checkpoints.releaseView(windowId, input.viewId!, this.checkpoints.key(input.chatId, input.incarnationId, input.documentId!)); return { released: true }; }
    if (input.action === "list") {
      try { return { ...await documents.status(input.chatId, input.incarnationId), generation: artifactGeneration(), enabled: artifactEnabled() }; }
      catch (cause) {
        if (!this.remote) throw cause;
        const answer = await this.remote.execute(input, "artifact-status", { chatId: input.chatId, incarnationId: input.incarnationId, cursor: null });
        if (!answer.ok || !answer.artifactStatus) throw cause;
        return { ...answer.artifactStatus, documents: answer.artifactStatus.documents.map(value => ({ ...value, artifactRef: { artifactId: value.artifactId } })) };
      }
    }
    if (input.action === "system-extract") {
      assertArtifactGeneration(input.generation);
      return (await import("../../design/systems/service")).extractDesignSystem(input, backend);
    }
    const snapshot = await this.version(input), version = snapshot.version;
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
      validateCanvasCheckpoint(version.manifest, input.checkpoint);
      await this.checkpoints.save(input.chatId, input.incarnationId, input.checkpoint); return { saved: true };
    }
    if (input.action === "read") {
      const versions = documents.store.versions(version.authority, version.manifest.documentId);
      let live: { revision: number; dirty: boolean; undoRevision: number | null; redoRevision: number | null } | undefined, generation = artifactGeneration(), enabled = artifactEnabled();
      let history = versions.map(value => ({ revision: value.revision, artifactId: value.artifactId, createdAt: value.createdAt }));
      if (snapshot.remote && this.remote) {
        enabled = false; generation = "unknown";
        try {
          const target = await this.remote.capability(input), answer = await this.remote.execute(input, "artifact-status", { chatId: input.chatId, incarnationId: input.incarnationId, cursor: null });
          if (answer.ok && answer.artifactStatus) { generation = answer.artifactStatus.capability.generation;
            enabled = artifactEnabled() && artifactExecutionState({ online: target.online, protocolVersion: target.protocolVersion, capability: answer.artifactStatus.capability, now: Date.now(), requiredProtocol: PROTOCOL_VERSION }) === "ready";
            live = answer.artifactStatus.documents.find(value => value.documentId === version.manifest.documentId);
          }
          let cursor = 0; history = [];
          for (let page = 0; page < 8; page++) { const answer = await this.remote.execute(input, "artifact-history", { chatId: input.chatId, incarnationId: input.incarnationId, artifactId: input.artifactId, cursor });
            if (!answer.ok || !answer.artifactHistory) break;
            history.push(...answer.artifactHistory.versions.map(value => ({ revision: value.revision, artifactId: value.artifactId, createdAt: 0 })));
            if (!answer.artifactHistory.cursor) break; cursor = answer.artifactHistory.cursor;
          }
        } catch { /* Offline reading preserves frozen snapshots and recovery input. */ }
      } else { try { live = (await documents.status(input.chatId, input.incarnationId)).documents.find(value => value.documentId === version.manifest.documentId); } catch { enabled = false; } }
      return { documentId: version.manifest.documentId, title: version.manifest.title, manifest: version.manifest, editable: snapshot.remote ? true : snapshot.editable,
        canvas: readCanvas(version.manifest, snapshot.files),
        fence: version.fence,
        revision: version.revision, latestRevision: Math.max(live?.revision ?? 0, history.at(-1)?.revision ?? 0, version.revision), readSetDigest: version.readSetDigest, snapshotRef: version.snapshotRef,
        generation, enabled, previewEnabled: artifactEnabled(), dirty: live?.dirty ?? false,
        undoRevision: live?.undoRevision ?? null, redoRevision: live?.redoRevision ?? null,
        checkpoint: this.checkpoints.read(input.chatId, input.incarnationId, version.manifest.documentId),
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
      return answer.artifactCanvasTarget ?? answer.artifactDifference ?? answer.artifactOperation;
    }
    if (input.action === "operation-status") return documents.operationStatus({ ...input, documentId: version.manifest.documentId });
    if (input.action === "thumbnail") return (await import("./thumbnails")).designThumbnail(input, this);
    if (input.action === "export") {
      assertArtifactGeneration(input.generation);
      const result = await (await import("../../design/editing/export")).exportDesignRevision(input, snapshot);
      return this.saveExport(input, windowId, result);
    }
    if (input.action !== "preview") await this.assertExecution(input, snapshot.remote);
    if (input.action === "canvas-target") return (await import("../../design/canvas/service")).canvasTarget(input, snapshot);
    if (input.action === "canvas") return (await import("../../design/canvas/service")).editCanvasRevision(input, snapshot);
    if (input.action === "resume-edit") return documents.operationStatus({ ...input, documentId: version.manifest.documentId }, true);
    if (input.action === "resolve-edit") return documents.resolveConflict({ ...input, documentId: version.manifest.documentId }, () => assertArtifactGeneration(input.generation));
    if (input.action === "review") {
      if (!input.checkpoint || input.checkpoint.documentId !== version.manifest.documentId || input.checkpoint.revision !== version.revision) throw new Error("Review belongs to another version");
      const { resolveDesignAnchor } = await import("../../design/editing/source-patch");
      const notes = input.checkpoint.notes.map(note => {
        if (!note.anchor) return note;
        const board = version.manifest.boards.find(board => board.id === note.anchor!.boardId), file = snapshot.files.find(file => file.path === board?.file);
        if (!file) throw new Error("Review target is missing");
        return { ...note, anchor: { ...resolveDesignAnchor(new TextDecoder("utf-8", { ignoreBOM: true }).decode(file.data), note.anchor, true).anchor, file: board!.file } };
      });
      const checkpoint = { ...input.checkpoint, notes }; await this.checkpoints.save(input.chatId, input.incarnationId, checkpoint);
      return { prompt: formatDesignReview(checkpoint, version.readSetDigest), checkpoint, title: version.manifest.title,
        design: { artifactId: version.artifactId, documentId: version.manifest.documentId, revision: version.revision, readSetDigest: version.readSetDigest, generation: input.generation,
          anchors: Object.fromEntries(notes.map((note, index) => [String(index + 1), note.anchor])) } };
    }
    if (input.action === "patch") return (await import("../../design/editing/service")).editDesignRevision(input, snapshot);
    if (input.action.startsWith("system-")) return (await import("../../design/systems/service")).designSystemAction(input, snapshot);
    if (input.action === "restore") {
      if (!snapshot.editable || !input.targetRevision) throw new Error("This retained version is read only");
      const target = await documents.readRevision(input.chatId, input.incarnationId, version.manifest.documentId, input.targetRevision);
      return documents.edit(input, version, async source => {
        const files = new Map(source.files.map(file => [file.path, file.data]));
        for (const file of target.files) files.set(file.path, Buffer.from(file.data));
        return [...files].map(([path, data]) => ({ path, data }));
      });
    }
    if (input.action === "preview") {
      const prepared = await prepareDesignSnapshot(snapshot, input.boardId);
      if (snapshot.remote) assertArtifactAdmission(); else assertArtifactGeneration(input.generation);
      const nonce = randomUUID(), selectionNonce = randomUUID(), id = randomUUID();
      const html = designFrameHtml(prepared.html.toString("utf8"), { id, nonce, selectionNonce, generation: input.generation!, boardId: prepared.metadata.boardId, boardDigest: prepared.metadata.boardDigest, navigation: prepared.metadata.navigation });
      return { ...await artifactRuntime()!.gateway.issuePrepared({ chatId: input.chatId, incarnationId: input.incarnationId, artifactId: version.artifactId }, windowId, id, html),
        nonce, selectionNonce, generation: input.generation, ...prepared.metadata };
    }
    throw new Error("This workspace action is not available");
  }
}
