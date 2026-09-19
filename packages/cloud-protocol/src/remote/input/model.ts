/**
 * [INPUT]: Depends on closed identities, encrypted file descriptors and canonical text budgets.
 * [OUTPUT]: Provides portable composer capabilities, bounded attachments and scope-bound Full Access consent.
 * [POS]: Remote input contract; no local paths or global computer grants can cross this boundary.
 */
import { z } from "zod";
import { cloudIdSchema as id } from "../../auth";
import { encryptedFileDescriptorSchema } from "../../blobs/encrypted/model";
import { ATTACHMENT_LIMIT, ATTACHMENT_FILENAME_BYTE_LIMIT } from "../../chats/content/budgets";
import { utf8Length } from "../../chats/content/parts";

export const REMOTE_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const REMOTE_ATTACHMENT_HOLD_MS = 24 * 60 * 60_000;
export const REMOTE_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const remotePermissionModeSchema = z.enum(["ask-for-approval", "approve-for-me", "full-access"]);
export type RemotePermissionMode = z.infer<typeof remotePermissionModeSchema>;
export const remoteComposerCapabilitiesSchema = z.object({
  imageInput: z.boolean(), fileInput: z.boolean(), planMode: z.boolean(),
  permissionModes: z.array(remotePermissionModeSchema).max(3),
}).strict();
export type RemoteComposerCapabilities = z.infer<typeof remoteComposerCapabilitiesSchema>;
export const remoteAttachmentSchema = z.object({
  attachmentId: z.string().regex(/^[A-Za-z0-9_-]{10,64}$/),
  filename: z.string().min(1).refine(value => utf8Length(value) <= ATTACHMENT_FILENAME_BYTE_LIMIT && !/[\p{Cc}/\\]/u.test(value), "remote-filename-invalid"),
  kind: z.enum(["image", "file"]),
  blob: encryptedFileDescriptorSchema,
}).strict().refine(value => value.blob.bytes > 0 && value.blob.bytes <= REMOTE_ATTACHMENT_BYTES &&
  (value.kind === "image" ? REMOTE_IMAGE_TYPES.some(mime => mime === value.blob.mime) : !value.blob.mime.startsWith("image/")), "remote-attachment-invalid");
export const remoteAttachmentsSchema = z.array(remoteAttachmentSchema).max(ATTACHMENT_LIMIT).refine(values =>
  new Set(values.map(value => value.attachmentId)).size === values.length && new Set(values.map(value => value.blob.blobId)).size === values.length, "remote-attachment-duplicate");
export type RemoteAttachment = z.infer<typeof remoteAttachmentSchema>;
export const remoteLegacyConsentSchema = z.object({
  version: z.literal(1), userId: z.string().min(1).max(256), sourceDeviceId: id,
  chatId: id, incarnationId: id, targetDeviceId: id, executionEpoch: z.number().int().nonnegative(),
}).strict();
export const remoteIntentConsentSchema = z.object({ version: z.literal(2), userId: z.string().min(1).max(256), sourceDeviceId: id,
  chatId: id, incarnationId: id, intentId: id, intendedTargetDeviceId: id }).strict();
export const remoteFullAccessConsentSchema = z.discriminatedUnion("version", [remoteLegacyConsentSchema, remoteIntentConsentSchema]);
export type RemoteFullAccessConsent = z.infer<typeof remoteFullAccessConsentSchema>;

export function remoteAttachmentBlobIds(payload: { kind: string; attachments?: RemoteAttachment[] }): string[] {
  return "attachments" in payload ? (payload.attachments ?? []).map(value => value.blob.blobId) : [];
}
export function remoteConsentMatches(consent: RemoteFullAccessConsent | undefined, scope: { userId: string; sourceDeviceId: string; chatId: string; incarnationId: string; targetDeviceId: string; executionEpoch: number; intentId?: string }) {
  return Boolean(consent && consent.userId === scope.userId && consent.sourceDeviceId === scope.sourceDeviceId &&
    consent.chatId === scope.chatId && consent.incarnationId === scope.incarnationId &&
    (consent.version === 2 ? consent.intentId === scope.intentId && consent.intendedTargetDeviceId === scope.targetDeviceId :
      consent.targetDeviceId === scope.targetDeviceId && consent.executionEpoch === scope.executionEpoch));
}
