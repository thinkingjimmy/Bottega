/**
 * [INPUT]: DurableJson publication, complete tar snapshots and strict document identities.
 * [OUTPUT]: Scoped journal, durable source-write effects/conflicts, semantic navigation, immutable revisions and exact Fork aliases.
 * [POS]: Existing document storage authority; source writes use the separately guarded prepared edit effect.
 */
import { z } from "zod";
import { join } from "node:path";
import { readFile, rm } from "node:fs/promises";
import { artifactFenceSchema } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import { DurableJson, durableReplaceBytes } from "../../persistence/durable-json";
import { designDigest, documentKey, manifestSchema, type DesignAuthority } from "./model";
import { workspaceCommandSchema, sourcePath, digestSchema } from "@ai-chat/cloud-protocol/artifacts/design/model";

const authoritySchema = z.object({ chatId: z.string(), incarnationId: z.string(), workspace: z.string(),
  ownerId: z.string(), authorityIdentity: z.string() }).strict();
const revisionSchema = z.object({ authority: authoritySchema, path: z.string(), manifest: manifestSchema,
  revision: z.number().int().positive(), readSetDigest: z.string(), snapshotRef: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  requestId: z.string(), createdAt: z.number(), artifactId: z.string().uuid(), messageId: z.string(), backend: z.string(),
  fence: artifactFenceSchema,
  history: z.object({ action: z.enum(["undo", "redo"]), targetRevision: z.number().int().positive() }).strict().optional(),
}).strict();
const operationSchema = z.object({ key: z.string(), parameterDigest: z.string(),
  state: z.enum(["prepared", "complete", "source-conflict", "rejected"]), revision: revisionSchema,
  sourceEdit: z.object({ input: workspaceCommandSchema, baseline: z.array(z.object({ path: sourcePath, digest: digestSchema }).strict()).max(64), applied: z.boolean(),
    writes: z.array(z.object({ path: sourcePath, state: z.enum(["started", "applied"]) }).strict()).max(64).default([]) }).strict().optional(),
  conflict: z.object({ paths: z.array(sourcePath).max(128), message: z.string().max(500), resolvedAt: z.number().optional() }).strict().optional(),
  aliasOf: z.string().max(512).optional(),
}).strict();
const indexSchema = z.object({ schemaVersion: z.literal(1), operations: z.array(operationSchema) }).strict();
export type DesignRevision = z.infer<typeof revisionSchema>;
export type DesignOperation = z.infer<typeof operationSchema>;

export class DesignDocumentStore {
  private readonly index: DurableJson<z.infer<typeof indexSchema>>;
  constructor(readonly root: string) {
    this.index = new DurableJson(join(root, "documents-v1.json"), indexSchema, () => ({ schemaVersion: 1, operations: [] }));
  }
  initialize() { return this.index.initialize(); }
  operations() { return this.index.read(value => value.operations); }
  operation(key: string) { return this.index.read(value => value.operations.find(item => item.key === key) ?? null); }
  pending() { return this.index.read(value => value.operations.filter(item => item.state === "prepared")); }
  blocking() { return this.index.read(value => value.operations.filter(item => item.state === "prepared" || item.state === "source-conflict")); }
  versions(authority: DesignAuthority, documentId: string) {
    const key = documentKey(authority, documentId);
    return this.index.read(value => value.operations.filter(operation => operation.state === "complete" &&
      documentKey(operation.revision.authority, operation.revision.manifest.documentId) === key &&
      operation.revision.authority.chatId === authority.chatId && operation.revision.authority.incarnationId === authority.incarnationId)
      .map(operation => operation.revision).sort((a, b) => a.revision - b.revision));
  }
  navigation(authority: DesignAuthority, documentId: string) {
    const past: number[] = [], future: number[] = []; let current: number | null = null;
    for (const version of this.versions(authority, documentId)) {
      const step = version.history, from = step?.action === "undo" ? past : future, to = step?.action === "undo" ? future : past;
      if (step && from.at(-1) === step.targetRevision && current !== null) { from.pop(); to.push(current); current = step.targetRevision; }
      else { if (current !== null) past.push(current); current = version.revision; future.length = 0; }
    }
    return { undoRevision: past.at(-1) ?? null, redoRevision: future.at(-1) ?? null };
  }
  latest(ownerId: string, documentId: string, scope?: Pick<DesignAuthority, "chatId" | "incarnationId">) {
    return this.index.read(value => {
      const candidates = value.operations.filter(operation => operation.state === "complete" &&
      operation.revision.authority.ownerId === ownerId && operation.revision.manifest.documentId === documentId)
      .map(operation => operation.revision).sort((a, b) => b.revision - a.revision);
      return (scope ? candidates.find(value => value.authority.chatId === scope.chatId && value.authority.incarnationId === scope.incarnationId) : null) ?? candidates[0] ?? null;
    });
  }
  alias(operation: DesignOperation) { return this.index.mutate(value => { if (!value.operations.some(item => item.key === operation.key)) value.operations.push(operation); }); }
  path(snapshotRef: string) {
    if (!/^sha256:[a-f0-9]{64}$/.test(snapshotRef)) throw new Error("Invalid document snapshot identity");
    return join(this.root, "snapshots", snapshotRef.slice(7) + ".tar");
  }
  async archive(snapshotRef: string, bytes: Uint8Array) {
    if (designDigest(bytes) !== snapshotRef) throw new Error("Document snapshot integrity failure");
    await durableReplaceBytes(this.path(snapshotRef), bytes);
  }
  async read(snapshotRef: string) {
    const bytes = await readFile(this.path(snapshotRef));
    if (designDigest(bytes) !== snapshotRef) throw new Error("Document snapshot integrity failure");
    return bytes;
  }
  prepare(operation: DesignOperation) {
    return this.index.mutate(value => {
      if (value.operations.some(item => item.key === operation.key)) throw new Error("Document request already exists");
      value.operations.push(operation);
    });
  }
  complete(key: string) {
    return this.index.mutate(value => {
      const operation = value.operations.find(item => item.key === key);
      if (!operation) throw new Error("Document operation is missing");
      operation.state = "complete";
    });
  }
  sourceApplied(key: string) { return this.index.mutate(value => { const operation = value.operations.find(item => item.key === key); if (operation?.sourceEdit) operation.sourceEdit.applied = true; }); }
  sourceWrite(key: string, path: string, state: "started" | "applied") {
    return this.index.mutate(value => {
      const edit = value.operations.find(item => item.key === key)?.sourceEdit;
      if (!edit) throw new Error("Prepared source edit is missing");
      const write = edit.writes.find(value => value.path === path);
      if (!write) edit.writes.push({ path, state }); else if (state === "applied") write.state = state;
    });
  }
  sourceConflict(key: string, paths: string[], message: string) {
    return this.index.mutate(value => {
      const operation = value.operations.find(item => item.key === key);
      if (!operation?.sourceEdit || operation.sourceEdit.applied || operation.state !== "prepared") throw new Error("Source conflict cannot reject a published effect");
      operation.conflict = { paths: [...new Set(paths)].slice(0, 128), message: message.slice(0, 500) };
      operation.state = operation.sourceEdit.writes.length ? "source-conflict" : "rejected";
      return operation;
    });
  }
  resolveConflict(key: string) {
    return this.index.mutate(value => {
      const operation = value.operations.find(item => item.key === key);
      if (!operation?.conflict || !["source-conflict", "rejected"].includes(operation.state)) throw new Error("Source conflict is missing");
      if (operation.state === "source-conflict") { operation.state = "rejected"; operation.conflict.resolvedAt = Date.now(); }
      return operation;
    });
  }
  async releaseChat(chatId: string, incarnationId: string) {
    const removed = this.operations().filter(operation => operation.revision.authority.chatId === chatId && operation.revision.authority.incarnationId === incarnationId);
    await this.index.mutate(value => { value.operations = value.operations.filter(operation => !removed.some(item => item.key === operation.key)); });
    const retained = new Set(this.operations().map(operation => operation.revision.snapshotRef));
    for (const ref of new Set(removed.map(operation => operation.revision.snapshotRef))) if (!retained.has(ref)) await rm(this.path(ref), { force: true });
  }
  close() { return this.index.closeAndFlush(); }
}
