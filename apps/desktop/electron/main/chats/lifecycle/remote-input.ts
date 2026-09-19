/**
 * [INPUT]: Depends on verified remote descriptors, native hashing and the ordinary attachment payload shape.
 * [OUTPUT]: Validates main-only remote persistence payloads and their stable attachment identities.
 * [POS]: Trusted Chat persistence boundary; public renderer parsers continue to reject remote metadata.
 */
import { z } from "zod";
import { createHash } from "node:crypto";
import { remoteAttachmentSchema, REMOTE_ATTACHMENT_BYTES } from "@ai-chat/cloud-protocol/remote/input/model";
import type { ChatAttachmentPayload } from "../../../../shared/chats-ipc";
export const remoteAttachmentPayloadSchema = z.object({ filename: z.string(), mediaType: z.string(),
  dataUrl: z.string().max(Math.ceil(REMOTE_ATTACHMENT_BYTES * 4 / 3) + 256), remote: remoteAttachmentSchema,
}).strict().refine(value => {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]*)$/.exec(value.dataUrl);
  if (!match || match[1] !== value.mediaType || value.filename !== value.remote.filename || value.mediaType !== value.remote.blob.mime) return false;
  const bytes = Buffer.from(match[2]!, "base64");
  return bytes.length === value.remote.blob.bytes && createHash("sha256").update(bytes).digest("hex") === value.remote.blob.sha256;
}, "remote-attachment-integrity");
export type RemoteAttachmentPayload = z.infer<typeof remoteAttachmentPayloadSchema>;
export function remotePayload(value: ChatAttachmentPayload): RemoteAttachmentPayload | null {
  return "remote" in value ? remoteAttachmentPayloadSchema.parse(value) : null;
}
