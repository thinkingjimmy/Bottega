/**
 * [INPUT]: Depends on AttachmentStore persistence and Chat mutation outcome classification.
 * [OUTPUT]: Provides attachment-first commits into the owning Chat, with compensation only for known failures.
 * [POS]: Chat lifecycle transaction shared by ChatsService write paths.
 */
import type { ChatAttachmentMeta } from "../../../../shared/ipc/content/chats-ipc";
import type { AttachmentStore } from "../attachments/attachment-store";
import type { ParsedAttachmentPayload } from "../schema/chat-input";
import { isChatMutationOutcomeUnknown } from "../chat-store";
import { remotePayload } from "./remote-input";

export async function commitAttachments<T>(
  store: AttachmentStore,
  payloads: ParsedAttachmentPayload[] | undefined,
  commit: (metas: ChatAttachmentMeta[]) => Promise<T>,
  chatId: string,
): Promise<T> {
  const remote = (payloads ?? []).map(remotePayload);
  const metas = await store.persist(payloads ?? [], remote.length && remote.every(Boolean) ? remote.map(value => value!.remote.attachmentId) : undefined, chatId);
  try {
    return await commit(metas);
  } catch (cause) {
    if (!isChatMutationOutcomeUnknown(cause)) await store.remove(metas.map(meta => meta.id), chatId);
    throw cause;
  }
}
