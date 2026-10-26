/**
 * [INPUT]: Depends on pure canonical JSON, frozen preparation and original/canonical user-message contracts.
 * [OUTPUT]: Provides canonical prepared attachment metadata and the original sequenced user message shared by Agent switching, sync capture and ledger proof validation.
 * [POS]: Pure prepared-custody projection; reads no staged files and creates no new identity or execution authority.
 */
import type { ChatAttachmentMeta, UserChatMessage } from "../../../../../../shared/ipc/content/chats-ipc";
import type { PreparedManualTurn } from "../prepared-manual-turn";
import { canonicalJson } from "@ai-chat/cloud-protocol/encryption";

export function preparedAttachmentMetas(prepared: Pick<PreparedManualTurn, "persistence">): ChatAttachmentMeta[] {
  return (prepared.persistence?.input.attachmentPayloads ?? []).map(blob => ({
    id: blob.remote?.attachmentId ?? blob.blobId.replaceAll("-", ""),
    filename: blob.filename, mediaType: blob.mediaType, byteSize: blob.byteSize,
  }));
}

export function preparedUserMessage(prepared: Pick<PreparedManualTurn, "persistence" | "switchCommand">,
  original: UserChatMessage | Omit<UserChatMessage, "seq">, seq: number, stored?: UserChatMessage): UserChatMessage {
  const user = { ...original, seq }, blobs = prepared.persistence?.input.attachmentPayloads ?? [];
  if (original.attachments !== undefined || !blobs.length) return user;
  if (!stored) throw new Error("PREPARED_USER_ATTACHMENTS_UNAVAILABLE");
  const { attachments = [], ...base } = stored;
  const pinned = prepared.switchCommand?.userMessage.attachments;
  if (canonicalJson(base) !== canonicalJson(user) || attachments.length !== blobs.length ||
    new Set(attachments.map(file => file.id)).size !== attachments.length || blobs.some((blob, index) => {
      const file = attachments[index], id = pinned?.[index]?.id ?? blob.remote?.attachmentId;
      return !file || !/^[A-Za-z0-9_-]{10,64}$/.test(file.id) || id !== undefined && file.id !== id ||
        file.filename !== blob.filename || file.mediaType !== blob.mediaType || file.byteSize !== blob.byteSize;
    })) throw new Error("PREPARED_USER_ATTACHMENTS_CHANGED");
  // Ordinary persistence allocates attachment IDs; only a frozen switch or remote input already pins them.
  return { ...user, attachments };
}
