/**
 * [INPUT]: DurableJson publication, complete tar snapshots and strict current document identities and opaque unsupported envelopes.
 * [OUTPUT]: Selective fixed-revision/current-head reads and scoped journal with fixed create/replace/delete plans, durable path intents/receipts, conflicts, revisions, Fork aliases and per-document unsupported-operation blocks and atomic parent-owned imported ancestry.
 * [POS]: Existing document storage authority; source writes use the separately guarded prepared edit effect.
 */
import { z } from "zod";
import { unsupportedDesignManifest } from "@ai-chat/cloud-protocol/artifacts/design/core/retained";
import { designId } from "@ai-chat/cloud-protocol/artifacts/design/model";
import { join } from "node:path";
import { readFile, rm } from "node:fs/promises";
import { artifactFenceSchema } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import { DurableJson, durableReplaceBytes } from "../../persistence/durable-json";
import { DESIGN_EFFECT_LIMITS, DESIGN_SLIDES_LIMITS, designDigest, documentKey, manifestSchema, type DesignAuthority } from "./model";
import { workspaceCommandSchema, sourcePath, digestSchema } from "@ai-chat/cloud-protocol/artifacts/design/model";

const authoritySchema = z.object({ chatId: z.string(), incarnationId: z.string(), workspace: z.string(),
  ownerId: z.string(), authorityIdentity: z.string() }).strict();
const directorySchema = z.object({ path: z.union([z.literal(""), sourcePath]), identity: z.string().regex(/^\d+:\d+$/) }).strict();
const sourceEffectSchema = z.object({ path: sourcePath, kind: z.enum(["create", "replace", "delete"]),
  before: digestSchema.nullable(), after: digestSchema.nullable() }).strict();
const sourceWriteSchema = z.object({ path: sourcePath, state: z.enum(["started", "applied"]),
  parents: z.array(directorySchema).max(5).optional(), beforeStamp: z.string().nullable().optional(), afterStamp: z.string().nullable().optional() }).strict().refine(value => (value.parents?.length ?? 0) <= 4 || value.path === "db/data/users/local/runs.json" && value.parents?.every((parent, index) => parent.path === ["", "db", "db/data", "db/data/users", "db/data/users/local"][index]), "Only the exact Dashboard runs member permits five parent identities");
const revisionSchema = z.object({ authority: authoritySchema, path: z.string(), manifest: manifestSchema,
  revision: z.number().int().positive(), readSetDigest: z.string(), snapshotRef: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  requestId: z.string(), createdAt: z.number(), artifactId: z.string().uuid(), messageId: z.string(), backend: z.string(),
  fence: artifactFenceSchema,
}).strict();
const operationSchema = z.object({ key: z.string(), parameterDigest: z.string(),
  state: z.enum(["prepared", "complete", "source-conflict", "rejected"]), revision: revisionSchema,
  sourceEdit: z.object({ initial: z.literal(true).optional(), input: workspaceCommandSchema,
    baseline: z.array(z.object({ path: sourcePath, digest: digestSchema, stamp: z.string().optional() }).strict()).max(DESIGN_SLIDES_LIMITS.files), applied: z.boolean(),
    effects: z.array(sourceEffectSchema).max(DESIGN_EFFECT_LIMITS.files).optional(),
    directories: z.array(directorySchema).max(2048).optional(),
    writes: z.array(sourceWriteSchema).max(DESIGN_EFFECT_LIMITS.files).default([]) }).strict().optional(),
  conflict: z.object({ paths: z.array(sourcePath).max(DESIGN_EFFECT_LIMITS.files), message: z.string().max(500), resolvedAt: z.number().optional() }).strict().optional(),
  aliasOf: z.string().max(512).optional(), importOf: z.string().max(512).optional(), deliveryPending: z.literal(true).optional(), importCount: z.number().int().min(1).max(500).optional(),
  imported: z.object({ author: z.object({ kind: z.enum(["user", "agent", "restore", "external"]), name: z.string().min(1).max(80) }).strict(),
    at: z.number().nonnegative(), restoredFrom: z.number().int().positive().max(500).optional(), restoredPart: z.boolean().optional() }).strict().optional(),
}).strict();
const storedRevisionSchema = revisionSchema.omit({ manifest: true, fence: true }).extend({
  manifest: z.object({ documentId: designId }).passthrough(), fence: z.record(z.string(), z.unknown()), history: z.unknown().optional(),
}).strict();
function unsupportedOperation(value: { revision: { manifest: unknown; history?: unknown }; sourceEdit?: unknown }) {
  if (unsupportedDesignManifest(value.revision.manifest) || "history" in value.revision) return true;
  const input = (value.sourceEdit as { input?: { action?: unknown } } | undefined)?.input;
  return typeof input?.action === "string" && !workspaceCommandSchema.shape.action.options.includes(input.action as never);
}
const storedOperationSchema = operationSchema.omit({ revision: true, sourceEdit: true }).extend({
  revision: storedRevisionSchema, sourceEdit: z.unknown().optional(),
}).strict().superRefine((value, context) => {
  if (unsupportedOperation(value)) return;
  if (!operationSchema.safeParse(value).success) context.addIssue({ code: "custom", message: "Invalid current document operation" });
});
const indexSchema = z.object({ schemaVersion: z.literal(1), operations: z.array(storedOperationSchema) }).strict().superRefine((value, context) => {
  try { validateImports(value.operations.filter(item => !unsupportedOperation(item)) as unknown as DesignOperation[]); }
  catch { context.addIssue({ code: "custom", message: "Invalid imported document transaction" }); }
});
function validateImportGroup(parent: DesignOperation, children: readonly DesignOperation[]) {
  const all = [...children, parent], version = parent.revision;
  if (parent.importOf || parent.importCount !== all.length || all.length > 500 || version.revision !== all.length ||
    new Set(all.map(item => item.key)).size !== all.length || new Set(all.map(item => item.revision.artifactId)).size !== all.length) throw new Error("Invalid import parent or contiguous ancestry");
  for (const [index, item] of all.entries()) {
    const revision = item.revision, summary = revision.fence.design;
    if (revision.revision !== index + 1 || item.state !== parent.state || revision.path !== version.path || JSON.stringify(revision.authority) !== JSON.stringify(version.authority) ||
      revision.manifest.documentId !== version.manifest.documentId || revision.manifest.format !== version.manifest.format || revision.manifest.contentFormat !== version.manifest.contentFormat ||
      revision.messageId !== version.messageId || revision.artifactId !== revision.fence.id || revision.fence.sha256 !== revision.snapshotRef.slice(7) || !summary || summary.documentId !== version.manifest.documentId ||
      summary.revision !== revision.revision || summary.snapshotRef !== revision.snapshotRef || summary.readSetDigest !== revision.readSetDigest || summary.format !== revision.manifest.format || summary.contentFormat !== revision.manifest.contentFormat ||
      item !== parent && (item.importOf !== parent.key || item.importCount || item.sourceEdit || item.aliasOf || item.deliveryPending)) throw new Error("Invalid imported history identity or state");
  }
}
function validateImports(operations: readonly DesignOperation[]) {
  for (const item of operations) {
    if (item.importCount) validateImportGroup(item, operations.filter(child => child.importOf === item.key).sort((a, b) => a.revision.revision - b.revision.revision));
    if (item.deliveryPending && (!item.importCount || item.state !== "complete")) throw new Error("Pending imported delivery requires complete content and its parent");
    if (item.importOf && !operations.some(parent => parent.key === item.importOf && parent.importCount)) throw new Error("An imported child has no parent");
  }
}
export type DesignRevision = z.infer<typeof revisionSchema>;
export type DesignOperation = z.infer<typeof operationSchema>;
export type DesignSourceEffect = z.infer<typeof sourceEffectSchema>;
export type DesignSourceWrite = z.infer<typeof sourceWriteSchema>;

export class DesignDocumentStore {
  private readonly index: DurableJson<z.infer<typeof indexSchema>>;
  constructor(readonly root: string) {
    this.index = new DurableJson(join(root, "documents-v1.json"), indexSchema, () => ({ schemaVersion: 1, operations: [] }));
  }
  initialize() { return this.index.initialize(); }
  private current(value: z.infer<typeof indexSchema>) {
    // The storage schema validates every supported record on load and before each durable write.
    return value.operations.filter(raw => !unsupportedOperation(raw)) as unknown as DesignOperation[];
  }
  operations() { return this.index.read(value => this.current(value)); }
  operation(key: string) { return this.index.read(value => this.current(value).find(item => item.key === key) ?? null); }
  pending() { return this.index.read(value => this.current(value).filter(item => (item.state === "prepared" || item.deliveryPending) && !item.importOf)); }
  blocking() { return this.index.read(value => this.current(value).filter(item => !item.importOf && (item.state === "prepared" || item.state === "source-conflict" || item.deliveryPending))); }
  unsupportedBlocks(authority: DesignAuthority, documentId: string) {
    return this.index.read(value => value.operations.some(item =>
      (item.state === "prepared" || item.state === "source-conflict") && unsupportedOperation(item) &&
      item.revision.authority.ownerId === authority.ownerId && item.revision.manifest.documentId === documentId));
  }
  versions(authority: DesignAuthority, documentId: string) {
    const key = documentKey(authority, documentId);
    return this.index.read(value => this.current(value).filter(operation => operation.state === "complete" &&
      documentKey(operation.revision.authority, operation.revision.manifest.documentId) === key &&
      operation.revision.authority.chatId === authority.chatId && operation.revision.authority.incarnationId === authority.incarnationId)
      .map(operation => operation.revision).sort((a, b) => a.revision - b.revision));
  }
  revision(authority: DesignAuthority, documentId: string, revision: number) {
    const key = documentKey(authority, documentId);
    return this.index.read(value => this.current(value).find(operation => operation.state === "complete" && operation.revision.revision === revision &&
      documentKey(operation.revision.authority, operation.revision.manifest.documentId) === key)?.revision ?? null);
  }
  heads(authority: DesignAuthority) {
    return this.index.read(value => {
      const latest = new Map<string, DesignRevision>();
      for (const operation of this.current(value)) {
        const version = operation.revision;
        if (operation.state !== "complete" || version.authority.ownerId !== authority.ownerId ||
          version.authority.chatId !== authority.chatId || version.authority.incarnationId !== authority.incarnationId) continue;
        if ((latest.get(version.manifest.documentId)?.revision ?? 0) < version.revision) latest.set(version.manifest.documentId, version);
      }
      return [...latest.values()];
    });
  }
  latest(ownerId: string, documentId: string, scope?: Pick<DesignAuthority, "chatId" | "incarnationId">) {
    return this.index.read(value => {
      let latest: DesignRevision | null = null, matched: DesignRevision | null = null;
      for (const operation of this.current(value)) {
        const version = operation.revision;
        if (operation.state !== "complete" || version.authority.ownerId !== ownerId || version.manifest.documentId !== documentId) continue;
        if (!latest || latest.revision < version.revision) latest = version;
        if (scope && version.authority.chatId === scope.chatId && version.authority.incarnationId === scope.incarnationId &&
          (!matched || matched.revision < version.revision)) matched = version;
      }
      return matched ?? latest;
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
  async prepareImport(parent: DesignOperation, children: readonly DesignOperation[]) {
    const root = operationSchema.parse({ ...parent, importCount: children.length + 1 });
    const history = children.map(value => operationSchema.parse({ ...value, importOf: root.key }));
    if (root.state !== "prepared") throw new Error("An import requires one prepared parent");
    validateImportGroup(root, history);
    return this.index.mutate(value => {
      const keys = new Set([root, ...history].map(item => item.key));
      if (value.operations.some(item => keys.has(item.key) || documentKey(item.revision.authority, item.revision.manifest.documentId) === documentKey(root.revision.authority, root.revision.manifest.documentId))) throw new Error("Imported document identity already exists");
      value.operations.push(...history, root);
    });
  }
  importHistory(parent: DesignOperation) { return this.operations().filter(value => value.importOf === parent.key).sort((a, b) => a.revision.revision - b.revision.revision); }
  prepare(operation: DesignOperation) {
    return this.index.mutate(value => {
      if (operation.importOf || operation.importCount || value.operations.some(item => item.key === operation.key)) throw new Error("Document request already exists or requires its import parent");
      value.operations.push(operation);
    });
  }
  complete(key: string, deliveryPending = false) {
    return this.index.mutate(value => {
      const raw = value.operations.find(item => item.key === key);
      const operation = raw ? operationSchema.parse(raw) : undefined;
      if (!operation) throw new Error("Document operation is missing");
      if (operation.importOf) throw new Error("Only the import parent can complete its ancestry");
      for (const child of value.operations) if (child.importOf === operation.key) child.state = "complete";
      operation.state = "complete";
      if (deliveryPending) operation.deliveryPending = true; else delete operation.deliveryPending;
      Object.assign(raw!, operation);
    });
  }
  deliveryComplete(key: string) { return this.index.mutate(value => {
    const raw = value.operations.find(item => item.key === key), operation = raw ? operationSchema.parse(raw) : undefined;
    if (!operation?.importCount || operation.importOf || operation.state !== "complete") throw new Error("Imported delivery requires its complete parent");
    delete raw!.deliveryPending;
  }); }
  sourceApplied(key: string) { return this.index.mutate(value => { const raw = value.operations.find(item => item.key === key);
      const operation = raw ? operationSchema.parse(raw) : undefined; if (operation?.sourceEdit) { operation.sourceEdit.applied = true; Object.assign(raw!, operation); } }); }
  sourceWrite(key: string, path: string, state: "started" | "applied", details: Omit<DesignSourceWrite, "path" | "state"> = {}) {
    return this.index.mutate(value => {
      const raw = value.operations.find(item => item.key === key);
      const edit = raw ? operationSchema.parse(raw).sourceEdit : undefined;
      if (!edit) throw new Error("Prepared source edit is missing");
      if (edit.effects && !edit.effects.some(effect => effect.path === path)) throw new Error("Source effect is not in the prepared plan");
      const write = edit.writes.find(value => value.path === path);
      if (!write) {
        if (state !== "started") throw new Error("Source effect has no durable intent");
        edit.writes.push({ path, state, ...details });
      } else if (state === "applied") { write.state = state; write.afterStamp = details.afterStamp; }
      raw!.sourceEdit = edit;
    });
  }
  sourceConflict(key: string, paths: string[], message: string) {
    return this.index.mutate(value => {
      const raw = value.operations.find(item => item.key === key);
      const operation = raw ? operationSchema.parse(raw) : undefined;
      if (!operation?.sourceEdit || operation.sourceEdit.applied || operation.state !== "prepared") throw new Error("Source conflict cannot reject a published effect");
      operation.conflict = { paths: [...new Set(paths)].slice(0, DESIGN_EFFECT_LIMITS.files), message: message.slice(0, 500) };
      operation.state = operation.sourceEdit.writes.length ? "source-conflict" : "rejected";
      for (const child of value.operations) if (child.importOf === operation.key) child.state = operation.state;
      Object.assign(raw!, operation);
      return operation;
    });
  }
  resolveConflict(key: string) {
    return this.index.mutate(value => {
      const raw = value.operations.find(item => item.key === key);
      const operation = raw ? operationSchema.parse(raw) : undefined;
      if (!operation?.conflict || !["source-conflict", "rejected"].includes(operation.state)) throw new Error("Source conflict is missing");
      if (operation.state === "source-conflict") { operation.state = "rejected"; operation.conflict.resolvedAt = Date.now();
        for (const child of value.operations) if (child.importOf === operation.key) child.state = "rejected"; }
      Object.assign(raw!, operation);
      return operation;
    });
  }
  async releaseChat(chatId: string, incarnationId: string) {
    const removed = this.operations().filter(operation => operation.revision.authority.chatId === chatId && operation.revision.authority.incarnationId === incarnationId);
    await this.index.mutate(value => { value.operations = value.operations.filter(operation => !removed.some(item => item.key === operation.key)); });
    const retained = this.index.read(value => new Set(value.operations.map(operation => operation.revision.snapshotRef)));
    for (const ref of new Set(removed.map(operation => operation.revision.snapshotRef))) if (!retained.has(ref)) await rm(this.path(ref), { force: true });
  }
  close() { return this.index.closeAndFlush(); }
}
