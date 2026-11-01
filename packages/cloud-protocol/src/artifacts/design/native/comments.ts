/**
 * [INPUT]: Fixed native version-1 comments.json bytes and user-authored comment metadata.
 * [OUTPUT]: Bounded native thread/message, compose, stable pending save and unsent-input schemas plus readNativeComments.
 * [POS]: Source data contract shared by the trusted editor bridge and journal; no model or write authority.
 */
import { z } from "zod";
import { sourcePath } from "../reference/path";
import { digestSchema } from "../reference/identifiers";
const id = z.string().min(1).max(128), time = z.number().finite().nonnegative();
const message = z.object({ id, author: z.object({ kind: z.enum(["user", "agent"]), name: z.string().max(100) }).strict(),
  text: z.string().max(10000), at: time, editedAt: time.optional() }).strict();
export const nativeComposeSchema = z.object({ requestId: z.string().uuid(), anchor: z.string().min(1).max(2048), label: z.string().max(1000),
  file: sourcePath.optional(), snapshotRef: digestSchema.optional(), readSetDigest: digestSchema.optional(), revision: z.number().int().positive().optional(),
  detail: z.string().max(4000).optional(), section: z.string().max(200).optional(), area: z.boolean().optional(), text: z.string().max(10000).default("") }).strict();
export const nativeThreadSchema = z.object({ id, anchor: z.string().min(1).max(2048), label: z.string().max(1000), detail: z.string().max(4000).optional(),
  location: z.record(z.string().max(128), z.unknown()), status: z.enum(["open", "resolved"]), createdAt: time, updatedAt: time,
  messages: z.array(message).max(64).refine(values => new Set(values.map(row => row.id)).size === values.length), resolvedAt: time.optional(),
  agent: z.object({ status: z.enum(["pending", "delivered", "replied"]), sentAt: time, deliveredAt: time.optional(), repliedAt: time.optional(), via: z.string().max(128).optional() }).strict().optional(),
}).strict();
export const nativeCommentsSchema = z.object({ version: z.literal(1), threads: z.array(nativeThreadSchema).max(200) }).strict()
  .refine(value => new Set(value.threads.map(thread => thread.id)).size === value.threads.length && new TextEncoder().encode(JSON.stringify(value)).length <= 1024 * 1024,
    "Native comments repeat an identity or exceed their byte budget");
export type NativeComments = z.infer<typeof nativeCommentsSchema>;
export type NativeCompose = z.infer<typeof nativeComposeSchema>;
export const nativeCommentSaveSchema = z.object({ requestId: z.string().uuid(), kind: z.enum(["create", "reply", "resolve", "reopen"]),
  at: z.number().int().nonnegative(), threadId: id, beforeDigest: digestSchema, digest: digestSchema }).strict();
export type NativeCommentSave = z.infer<typeof nativeCommentSaveSchema>;
export const nativeInputSchema = z.object({ instruction: z.string().max(4096).default(""), compose: nativeComposeSchema.optional(),
  reply: z.object({ threadId: id, text: z.string().max(10000) }).strict().optional(), pending: z.string().max(8192).optional(), commentSave: nativeCommentSaveSchema.optional() }).strict();
export type NativeInput = z.infer<typeof nativeInputSchema>;
export function readNativeComments(files: readonly { path: string; data: Uint8Array }[]): NativeComments {
  const file = files.find(file => file.path === "comments.json");
  if (!file) return { version: 1, threads: [] };
  if (file.data.length > 1024 * 1024) throw new Error("Native comments exceed their byte budget");
  return nativeCommentsSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.data)));
}
