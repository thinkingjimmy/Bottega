/**
 * [INPUT]: Verified resource operator, current account connection, owner Chat validation and existing encrypted Artifact file transfer.
 * [OUTPUT]: NativeRemoteSessions owns bounded native sessions, closing checkpoint/ack custody, strict encrypted large checkpoints, bounded content replies and pending-nonce original HTTP-shaped RPC.
 * [POS]: Owner-computer remote adapter; source writes remain in NativeEditorSession and the original journal.
 */
import { randomUUID } from "node:crypto";
import { artifactFenceSchema } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { protocolHeader, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import { nativeRemoteInputSchema, nativeRemoteResultSchema, nativeRemoteCheckpointSchema, type NativeRemoteInput, type NativeRemoteResult, type NativeRemoteFile } from "@ai-chat/cloud-protocol/resources/artifact/native";
import { NativeFileTransfer, nativeBytesSource } from "@ai-chat/cloud-protocol/artifacts/design/remote/files";
import { packArtifactArchive } from "@ai-chat/cloud-protocol/artifacts/archive";
import type { WorkspaceCommand } from "@ai-chat/cloud-protocol/artifacts/design/model";
import { artifactWorkspace } from "../../../../artifacts/workspace/runtime";
import { artifactRuntime } from "../../../../artifacts/core/runtime";
import { nativeEditorAssets } from "../../../../artifacts/render/native/assets";
import { designDigest } from "../../../../design/documents/model";
import type { DesktopBlobStore } from "../../../files/store";
import { NativeHeadMaterials } from "./heads";
type Operator = { userId: string; deviceId: string };
type Events = Extract<NativeRemoteResult, { kind: "events" }>["events"];
type Record = { id: string; token: string; operator: Operator; input: WorkspaceCommand; windowId: number; lease: { id: string; expiresAt: number };
  current(): void; controller: AbortController; files: DesktopBlobStore; transfer: NativeFileTransfer; runtime?: NativeRemoteFile; events: Events; root: boolean };
let nextWindow = -1;
export class NativeRemoteSessions {
  private readonly records = new Map<string, Record>();
  private readonly opens = new Map<string, { parameters: string; task: Promise<NativeRemoteResult> }>();
  private readonly timer: ReturnType<typeof setInterval>;
  private closed = false;
  private readonly heads: NativeHeadMaterials;
  constructor(private readonly ports: { config: CloudBuildConfig; deviceId: string; files(userId: string): DesktopBlobStore }) {
    this.heads = new NativeHeadMaterials(ports);
    this.timer = setInterval(() => this.prune(), 30_000); this.timer.unref?.();
  }
  private record(input: Exclude<NativeRemoteInput, { kind: "head" | "head-material" | "open" }>, operator: Operator, check = true) {
    const record = this.records.get(input.sessionId);
    if (!record || JSON.stringify(record.operator) !== JSON.stringify(operator) || record.token !== input.token ||
      ["chatId", "incarnationId", "artifactId", "viewId", "generation"].some(key => record.input[key as keyof WorkspaceCommand] !== input[key as keyof typeof input])) throw new Error("artifact-unavailable");
    record.current(); if (check) artifactRuntime()!.gateway.nativeSession(record.lease.id, record.windowId, input.kind === "request" ? input.nonce : undefined); return record;
  }
  private prune() { this.heads.prune(); for (const record of this.records.values()) { try { record.current(); if (Date.now() >= record.lease.expiresAt) throw new Error("expired"); } catch { void this.release(record); } } }
  private async release(record: Record) {
    if (!this.records.delete(record.id)) return;
    record.controller.abort(); artifactRuntime()?.gateway.release(record.lease.id, record.windowId);
    if (record.root) {
      for (const child of this.records.values()) if (child.windowId === record.windowId) await this.release(child);
      const workspace = artifactWorkspace(); workspace.candidates.releaseView(record.input, record.windowId); workspace.checkpoints.release(record.windowId);
      artifactRuntime()?.gateway.releaseWindow(record.windowId);
    }
    await record.transfer.close(); await record.files.close();
  }
  private async source(record: Record, file: NativeRemoteFile) {
    const descriptor = file.blob;
    if (descriptor.encryption.owner.kind !== "chat" || descriptor.encryption.owner.id !== record.input.chatId || descriptor.bytes > 24 * 1024 * 1024) throw new Error("artifact-budget");
    const local = await record.files.read(descriptor, { kind: "chat", id: record.input.chatId }, record.controller.signal); record.current();
    const handle = await open(local.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { const data = await handle.readFile(); if (data.length !== descriptor.bytes || designDigest(data) !== "sha256:" + descriptor.sha256) throw new Error("artifact-invalid"); return data; }
    finally { await handle.close(); }
  }
  private async wrap(input: WorkspaceCommand, lease: { id: string; expiresAt: number }, windowId: number, operator: Operator, current: () => void, root: boolean, events: Events = []): Promise<NativeRemoteResult> {
    current(); if (this.closed || this.records.size >= 8) throw new Error("artifact-budget");
    const id = randomUUID(), files = this.ports.files(operator.userId), controller = new AbortController();
    const transfer = new NativeFileTransfer(files.transfer, () => {
      current(); controller.signal.throwIfAborted(); const crypto = files.transfer.crypto;
      if (crypto.session.userId !== operator.userId) throw new Error("artifact-unavailable");
      return { ...protocolHeader(this.ports.config), expectedUserId: operator.userId, encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } };
    }, input.chatId);
    const record: Record = { id, token: randomUUID(), operator: { ...operator }, input, windowId, lease, current, controller, files, transfer, events, root };
    this.records.set(id, record);
    try {
      const native = artifactRuntime()!.gateway.nativeSession(lease.id, windowId), snapshot = native.snapshot();
      const source = packArtifactArchive(snapshot.files, 512), assets = await nativeEditorAssets(snapshot.version.manifest.contentFormat!); current();
      const runtime = packArtifactArchive([...assets].map(([path, data]) => ({ path, data })), 512);
      const sourceFile = await transfer.stage(id + ":source", nativeBytesSource(source), controller.signal);
      const runtimeFile = await transfer.stage(id + ":runtime", nativeBytesSource(runtime), controller.signal); current(); record.runtime = runtimeFile;
      return nativeRemoteResultSchema.parse({ kind: "opened", sessionId: id, token: record.token, leaseId: lease.id, expiresAt: lease.expiresAt,
        viewId: input.viewId, generation: input.generation, source: sourceFile, runtime: { blobId: runtimeFile.blob.blobId, sha256: runtimeFile.blob.sha256, bytes: runtimeFile.blob.bytes }, snapshotRef: snapshot.version.snapshotRef, readSetDigest: snapshot.version.readSetDigest, contentFormat: snapshot.version.manifest.contentFormat });
    } catch (cause) { await this.release(record); throw cause; }
  }
  async dispatch(raw: unknown, operator: Operator, commandCurrent: () => void, accountCurrent: () => void): Promise<NativeRemoteResult> {
    const input = nativeRemoteInputSchema.parse(raw); commandCurrent(); accountCurrent(); this.prune();
    if (this.closed) throw new Error("artifact-unavailable");
    const owner = await artifactRuntime()!.remote?.validate({ chatId: input.chatId, incarnationId: input.incarnationId, artifactId: input.artifactId });
    commandCurrent(); if (!owner || owner.ownerDeviceId !== this.ports.deviceId) throw new Error("artifact-unavailable");
    const workspace = artifactWorkspace();
    if (input.kind === "head-material") return this.heads.read(input, operator);
    if (input.kind === "head") {
      const head = await workspace.dispatch({ chatId: input.chatId, incarnationId: input.incarnationId, artifactId: input.artifactId, action: "native-head" }) as { fence: unknown; revision: number; snapshotRef: string; readSetDigest: string; generation: string; enabled: boolean; dirty: boolean; aiRollback?: { requestId: string }; checkpoint: unknown; documentId: string };
      commandCurrent(); return nativeRemoteResultSchema.parse(await this.heads.issue(input, operator, accountCurrent, { kind: "head", fence: artifactFenceSchema.parse(head.fence), revision: head.revision, snapshotRef: head.snapshotRef, readSetDigest: head.readSetDigest, generation: head.generation, enabled: head.enabled, dirty: head.dirty, aiRollback: head.aiRollback }, { checkpoint: head.checkpoint,
        checkpointConflicts: workspace.checkpoints.conflicts(input.chatId, input.incarnationId, head.documentId, head.revision) }));
    }
    if (input.kind === "open") {
      const key = JSON.stringify([operator.userId, operator.deviceId, input.chatId, input.incarnationId, input.viewId]);
      const parameters = designDigest(JSON.stringify(input)), known = this.opens.get(key);
      if (known) {
        if (known.parameters !== parameters) throw new Error("artifact-request-conflict");
        const result = await known.task;
        if (result.kind !== "opened" || !this.records.has(result.sessionId)) throw new Error("artifact-unavailable");
        return result;
      }
      if (this.opens.size >= 64) throw new Error("artifact-budget");
      const task = (async () => {
      const windowId = nextWindow--, events: Events = [], command: WorkspaceCommand = { action: "native-editor", chatId: input.chatId, incarnationId: input.incarnationId, artifactId: input.artifactId,
        documentId: input.documentId, viewId: input.viewId, generation: input.generation, expectedRevision: input.expectedRevision, readSetDigest: input.readSetDigest };
      workspace.checkpoints.observeRemote(windowId, input.viewId, workspace.checkpoints.key(input.chatId, input.incarnationId, input.documentId), accountCurrent, event => {
        const parsed = nativeRemoteResultSchema.safeParse({ kind: "events", events: [event] });
        if (parsed.success && parsed.data.kind === "events") { const next = parsed.data.events; events.splice(0, events.length, ...events.filter(value => value.type !== next[0]!.type).slice(-2), ...next); }
      });
      try {
        await workspace.dispatch({ ...command, action: "acquire-view" }, windowId);
        const lease = await workspace.dispatch(command, windowId) as { id: string; expiresAt: number }; commandCurrent();
        return await this.wrap(command, lease, windowId, operator, accountCurrent, true, events);
      } catch (cause) { workspace.checkpoints.release(windowId); artifactRuntime()?.gateway.releaseWindow(windowId); throw cause; }
      })();
      this.opens.set(key, { parameters, task }); return task;
    }
    const record = this.record(input, operator, !["close", "poll"].includes(input.kind) && input.kind !== "checkpoint" && !(input.kind === "workspace" && ["checkpoint", "ack-disable"].includes(input.command.action)));
    if (input.kind === "close") { await this.release(record); return { kind: "closed", released: true }; }
    if (input.kind === "poll") return { kind: "events", events: [...record.events] };
    if (input.kind === "runtime") { if (!record.runtime) throw new Error("artifact-unavailable"); return { kind: "material", file: record.runtime }; }
    if (input.kind === "workspace" || input.kind === "checkpoint") {
      const command = input.kind === "workspace" ? input.command : nativeRemoteCheckpointSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await this.source(record, input.file))));
      if (input.kind === "checkpoint" && ["chatId", "incarnationId", "artifactId", "documentId", "viewId", "generation"].some(key => command[key as keyof typeof command] !== input[key as keyof typeof input])) throw new Error("artifact-unavailable");
      commandCurrent(); record.current();
      if (command.documentId !== record.input.documentId) throw new Error("artifact-unavailable");
      const result = await workspace.dispatch(command, record.windowId); commandCurrent(); record.current();
      if (command.action === "ack-disable") record.events.splice(0, record.events.length, ...record.events.filter(event => event.type !== "before-disable" || event.nonce !== command.nonce));
      if (command.action === "native-candidate-preview") return this.wrap(record.input, result as { id: string; expiresAt: number }, record.windowId, operator, record.current, false);
      const bytes = Buffer.from(JSON.stringify(result));
      return nativeRemoteResultSchema.parse(bytes.length <= 2048 ? { kind: "workspace", json: result } :
        { kind: "workspace", result: await record.transfer.stageContent(record.id + ":result", bytes, "application/json", record.controller.signal) });
    }
    const native = artifactRuntime()!.gateway.nativeSession(record.lease.id, record.windowId, input.nonce);
    const bytes = input.body ? await this.source(record, input.body) : new Uint8Array(); commandCurrent();
    const request = Readable.from(bytes.length ? [bytes] : []) as IncomingMessage;
    request.method = input.method; request.headers = { origin: "https://native.invalid", "content-type": input.contentType,
      "x-bottega-native": native.token, "x-bottega-request": input.requestId, ...(input.filename ? { "x-bottega-filename": input.filename } : {}), ...(input.nonce ? { "x-bottega-final-flush": input.nonce } : {}) };
    const reply = await native.handle(request, "editor/" + input.path, "https://native.invalid"); commandCurrent(); record.current();
    if (!reply) throw new Error("artifact-unavailable");
    let json: unknown; if (reply.mime === "application/json" && reply.body.length <= 2048) json = JSON.parse(Buffer.from(reply.body).toString());
    return nativeRemoteResultSchema.parse({ kind: "response", status: reply.status, mime: reply.mime,
      ...(json ? { json } : { file: await record.transfer.stageContent(record.id + ":reply", reply.body, reply.mime, record.controller.signal) }) });
  }
  async close() { this.closed = true; clearInterval(this.timer); await Promise.all([...this.records.values()].map(record => this.release(record))); this.opens.clear(); await this.heads.close(); }
}
