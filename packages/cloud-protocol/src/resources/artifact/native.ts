/**
 * [INPUT]: Native workspace commands, authenticated encrypted-file descriptors and immutable Artifact fences.
 * [OUTPUT]: Closed bounded native remote session inputs and reference-only head/runtime/source/request/response bytes, strict checkpoint and same-Chat no-editor project import file commands and small inline workspace results and exact-view completed-source events.
 * [POS]: Existing encrypted resource protocol; verified operator identity never comes from these payloads.
 */
import { z } from "zod";
import { pendingArtifactChatSaveSchema } from "../../artifacts/design/chat/model";
import { artifactOperationSchema } from "./model";
import { artifactWorkspaceEventSchema } from "../../artifacts/design/events/model";
import { checkpointSchema } from "../../artifacts/design/review";
import { designReferenceSchema } from "../../artifacts/design/reference/model";
import { workspaceCommandSchema } from "../../artifacts/design/model";
import { digestSchema, designId } from "../../artifacts/design/reference/identifiers";
import { artifactFenceSchema } from "../../turns/text/artifact-reference";
import { encryptedFileDescriptorSchema } from "../../blobs/encrypted";
import { utf8JsonBytes } from "../../artifacts/design/core/transport";
const scope = { chatId: z.string().min(1).max(128), incarnationId: z.string().min(1).max(128), artifactId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) };
const owner = { ...scope, viewId: z.string().uuid(), generation: z.string().min(1).max(128) };
const session = { ...owner, sessionId: z.string().uuid(), token: z.string().uuid() };
const file = z.object({ blob: encryptedFileDescriptorSchema }).strict().refine(value => value.blob.bytes > 0 && value.blob.bytes <= 50_000_000, "Native bytes require a complete bounded encrypted file");
export const nativeRemoteCheckpointSchema = z.object({ ...scope, action: z.literal("checkpoint"), documentId: designId,
  viewId: z.string().uuid(), generation: z.string().min(1).max(128), checkpoint: checkpointSchema }).strict()
  .refine(value => value.checkpoint.documentId === value.documentId && value.checkpoint.save?.viewId === value.viewId, "Checkpoint material must retain its exact document and CAS consumer");
const workspace = workspaceCommandSchema.refine(value => value.action.startsWith("native-candidate") || ["preview", "system-bind", "native-ai-rollback", "native-history-list", "native-history-detail", "native-history-diff", "native-history-restore", "native-reference", "checkpoint", "review", "reference-check", "operation-status", "resume-edit", "ack-disable"].includes(value.action), "Use the declared native workspace actions").superRefine((value,context)=>{
  if(value.action!=="resume-edit")return;
  const keys=new Set(["action","chatId","incarnationId","artifactId","documentId","requestId","viewId","generation"]);
  if(!value.artifactId||!value.documentId||!value.viewId||!value.generation||!/^chat-edit-[a-f0-9]{48}$/.test(value.requestId??"")||Object.keys(value).some(key=>!keys.has(key)))context.addIssue({code:"custom",message:"Resume only the original scoped Chat save without new edit parameters"});
});
export const nativeRemoteInputSchema = z.discriminatedUnion("kind", [
  z.object({ chatId: scope.chatId, incarnationId: scope.incarnationId, kind: z.literal("project-import"), generation: owner.generation,
    requestId: z.string().min(1).max(128), file }).strict(),
  z.object({ ...scope, kind: z.literal("head"), mode: z.literal("fixed").optional(), reference: designReferenceSchema.optional() }).strict(),
  z.object({ ...scope, kind: z.literal("head-material"), materialId: z.string().uuid(), token: z.string().uuid(), material: z.enum(["source", "recovery"]) }).strict(),
  z.object({ ...owner, kind: z.literal("open"), documentId: designId, expectedRevision: z.number().int().positive(), readSetDigest: digestSchema }).strict(),
  z.object({ ...session, kind: z.literal("request"), requestId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    path: z.enum(["_files.json", "__deck/session", "__deck/publish", "__deck/assets", "__deck/comment-result", "__deck/adopt", "__deck/download", "__deck/presentation", "__deck/source", "__deck/dashboard", "__deck/dashboard-write", "__deck/preview"]),
    method: z.enum(["GET", "POST"]), contentType: z.string().min(1).max(128).optional(), filename: z.string().max(1000).optional(), nonce: z.string().uuid().optional(), body: file.optional() }).strict(),
  z.object({ ...session, kind: z.literal("workspace"), command: workspace }).strict(),
  z.object({ ...session, kind: z.literal("checkpoint"), documentId: designId, file }).strict(),
  z.object({ ...session, kind: z.literal("runtime") }).strict(),
  z.object({ ...session, kind: z.literal("poll") }).strict(),
  z.object({ ...session, kind: z.literal("close") }).strict(),
]).superRefine((value, context) => {
  const issue = (message: string) => context.addIssue({ code: "custom", message });
  if (value.kind === "project-import" && (value.file.blob.encryption.owner.kind !== "chat" || value.file.blob.encryption.owner.id !== value.chatId)) issue("The project file belongs to another Chat");
  if (value.kind === "head" && value.reference && (value.mode || value.reference.artifactId !== value.artifactId)) issue("Locate must retain its original reference and current-head read");
  if (value.kind === "request") {
    if (value.method === "GET" && !["_files.json", "__deck/session", "__deck/download"].includes(value.path) || value.method === "POST" && ["_files.json", "__deck/session"].includes(value.path)) issue("The native method does not match its route");
    if ((value.method === "POST") !== Boolean(value.body)) issue("Native POST bytes require their encrypted file descriptor");
    if (value.body && (value.body.blob.encryption.owner.kind !== "chat" || value.body.blob.encryption.owner.id !== value.chatId)) issue("The native request belongs to another Chat");
    if (value.body && value.body.blob.bytes > 24 * 1024 * 1024) issue("Native request bytes exceed their budget");
  }
  if (value.kind === "checkpoint" && (value.file.blob.bytes > 64 * 1024 || value.file.blob.mime !== "application/json" ||
    value.file.blob.encryption.owner.kind !== "chat" || value.file.blob.encryption.owner.id !== value.chatId)) issue("Checkpoint material requires a bounded same-Chat encrypted JSON file");
  if (value.kind === "workspace" && ["chatId", "incarnationId", "viewId", "generation"].some(key => value.command[key as keyof typeof value.command] !== value[key as keyof typeof value])) issue("The native command belongs to another consumer");
  if (utf8JsonBytes({ contract: "bottega.resource/v1", action: "artifact-native", input: value }) > 8192) issue("Complete native resource command exceeds 8 KiB");
});
export const nativeRemoteResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project-import"), operation: artifactOperationSchema }).strict(),
  z.object({ kind: z.literal("head"), materialId: z.string().uuid(), token: z.string().uuid(), expiresAt: z.number().int().positive(), fence: artifactFenceSchema, revision: z.number().int().positive(), snapshotRef: digestSchema, readSetDigest: digestSchema,
    generation: z.string().min(1).max(128), enabled: z.boolean(), dirty: z.boolean(), pendingChatEdit: pendingArtifactChatSaveSchema.optional(), aiRollback: z.object({ requestId: z.string().max(128) }).strict().optional() }).strict(),
  z.object({ kind: z.literal("opened"), sessionId: z.string().uuid(), token: z.string().uuid(), leaseId: z.string().uuid(), expiresAt: z.number().int().positive(),
    viewId: z.string().uuid(), generation: z.string().min(1).max(128), source: file, runtime: z.object({ blobId: z.string().uuid(), sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().positive().max(50_000_000) }).strict(), snapshotRef: digestSchema, readSetDigest: digestSchema, contentFormat: z.enum(["canvas-dc/v3", "slides/v4", "design-system/v1", "dashboard/v1"]), editorSource: file.optional() }).strict().superRefine((value, context) => {
      if (value.snapshotRef !== "sha256:" + value.source.blob.sha256 || (value.contentFormat === "design-system/v1") !== Boolean(value.editorSource)) context.addIssue({ code: "custom", message: "Canonical source and independent editor projection identities must agree" });
    }),
  z.object({ kind: z.literal("response"), status: z.union([z.literal(200), z.literal(201), z.literal(400), z.literal(403), z.literal(404), z.literal(409), z.literal(413)]),
    mime: z.string().min(1).max(128), json: z.record(z.string(), z.unknown()).optional(), file: file.optional() }).strict()
    .refine(value => Boolean(value.json) !== Boolean(value.file) && (!value.json || utf8JsonBytes(value.json) <= 2048), "Native response uses small metadata or the encrypted file channel"),
  z.object({ kind: z.literal("workspace"), json: z.record(z.string(), z.unknown()).optional(), result: file.optional() }).strict()
    .refine(value => Boolean(value.json) !== Boolean(value.result) && (!value.json || utf8JsonBytes(value.json) <= 2048), "Workspace result uses small metadata or the encrypted file channel"),
  z.object({ kind: z.literal("material"), file }).strict(),
  z.object({ kind: z.literal("events"), events: z.array(artifactWorkspaceEventSchema).max(4) }).strict(),
  z.object({ kind: z.literal("closed"), released: z.boolean() }).strict(),
]).refine(value => utf8JsonBytes({ ok: true, artifactNative: value }) <= 8192, "Complete native resource result exceeds 8 KiB");
export type NativeRemoteInput = z.infer<typeof nativeRemoteInputSchema>;
export type NativeRemoteResult = z.infer<typeof nativeRemoteResultSchema>;
export type NativeRemoteFile = z.infer<typeof file>;
