/**
 * [INPUT]: Closed device/library identities, relative paths and authenticated file descriptors.
 * [OUTPUT]: Remote workspace and Skill reference contracts plus bounded private workspace query results.
 * [POS]: Shared reference boundary; absolute paths and renderer-issued native capabilities cannot cross it.
 */
import { z } from "zod";
import { cloudIdSchema } from "../../auth";
import { sha256Schema } from "../../blobs";
import { encryptedFileDescriptorSchema } from "../../blobs/encrypted/model";
import { skillObjectIdSchema } from "../../skills/identity";
export const remoteRelativePathSchema = z.string().min(1).max(4096).refine(value =>
  !/[\\:]/u.test(value) && !Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) && !value.startsWith("/") && !value.split("/").some(part => !part || part === "." || part === ".."), "workspace-path-invalid");
export const remoteFileReferenceSchema = z.object({ kind: z.literal("file"), deviceId: cloudIdSchema, workspaceDigest: sha256Schema,
  path: remoteRelativePathSchema, entryKind: z.enum(["file", "dir"]) }).strict();
export const remoteSkillReferenceSchema = z.object({ kind: z.literal("skill"), libraryId: skillObjectIdSchema }).strict();
export const remoteReferencesSchema = z.array(z.discriminatedUnion("kind", [remoteFileReferenceSchema, remoteSkillReferenceSchema])).max(32)
  .refine(values => new Set(values.map(value => JSON.stringify(value))).size === values.length, "duplicate-reference");
export type RemoteReference = z.infer<typeof remoteReferencesSchema>[number];
export type RemoteFileReference = z.infer<typeof remoteFileReferenceSchema>;
export const remoteWorkspaceListSchema = z.object({ kind: z.literal("workspace-files"), deviceId: cloudIdSchema, workspaceDigest: sha256Schema,
  entries: z.array(z.object({ path: remoteRelativePathSchema, entryKind: z.enum(["file", "dir"]) }).strict()).max(50), truncated: z.boolean() }).strict();
export const remoteWorkspaceTextSchema = z.object({ kind: z.literal("workspace-text"), reference: remoteFileReferenceSchema,
  content: z.string().refine(value => new TextEncoder().encode(value).length <= 1024 * 1024, "workspace-text-too-large") }).strict();
export const remoteWorkspaceResultSchema = z.discriminatedUnion("kind", [remoteWorkspaceListSchema, remoteWorkspaceTextSchema]);
export type RemoteWorkspaceResult = z.infer<typeof remoteWorkspaceResultSchema>;
export const remoteWorkspaceOutputSchema = z.object({ kind: z.literal("workspace-result"), blob: encryptedFileDescriptorSchema }).strict();
export const isRemoteWorkspaceQuery = (kind: string) => kind === "list-workspace-files" || kind === "read-workspace-file";
export function assertRemoteReferenceTarget(references: readonly RemoteReference[], deviceId: string) {
  if (references.some(value => value.kind === "file" && value.deviceId !== deviceId)) throw new Error("reference-target-changed");
}
