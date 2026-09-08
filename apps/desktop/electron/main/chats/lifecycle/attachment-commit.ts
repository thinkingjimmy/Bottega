/**
 * [INPUT]: Depends on AttachmentStore persistence and Chat mutation outcome classification.
 * [OUTPUT]: Provides attachment-first commits with compensation only for known failures.
 * [POS]: Chat lifecycle transaction shared by ChatsService write paths.
 */
import type { ChatAttachmentMeta } from "../../../../shared/chats-ipc";
import type { AttachmentStore } from "../attachment-store";
import type { ParsedAttachmentPayload } from "../chat-input";
import { isChatMutationOutcomeUnknown } from "../chat-store";

export async function commitAttachments<T>(
  store: AttachmentStore,
  payloads: ParsedAttachmentPayload[] | undefined,
  commit: (metas: ChatAttachmentMeta[]) => Promise<T>,
): Promise<T> {
  const metas = await store.persist(payloads ?? []);
  try {
    return await commit(metas);
  } catch (cause) {
    if (!isChatMutationOutcomeUnknown(cause)) await store.remove(metas);
    throw cause;
  }
}
