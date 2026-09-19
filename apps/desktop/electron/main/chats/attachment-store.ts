/**
 * [INPUT]: Depends on the selected folder root getter and the shared chats/agent attachment contracts
 * [OUTPUT]: Provides verified attachment bytes, logical identity and the retained encrypted remote descriptor.
 * [POS]: Attachment byte owner of the chats module; bytes live in the folder beside their Chat and only ChatsService consumes them
 */

import type { ChatAttachmentMeta, ChatAttachmentPayload } from "../../../shared/chats-ipc";
import { LibraryAttachments } from "../library/assets/attachments";

/** Every read is Chat-scoped: an attachment id alone never identifies an owner. */
export class AttachmentStore {
  private readonly library: LibraryAttachments;
  constructor(libraryRoot: () => string | null) { this.library = new LibraryAttachments(libraryRoot); }
  persist(payloads: ChatAttachmentPayload[], stableIds: string[] | undefined, chatId: string): Promise<ChatAttachmentMeta[]> {
    return this.library.persist(payloads, stableIds, chatId);
  }
  remove(attachmentIds: readonly string[], chatId: string) { return this.library.remove(attachmentIds, chatId); }
  sweep(referencedIds: ReadonlySet<string>) { return this.library.sweep(referencedIds); }
  async logical(attachmentId: string, chatId: string) { return (await this.library.read(attachmentId, chatId)).blob; }
  async remoteDescriptor(attachmentId: string, chatId: string) { return (await this.library.read(attachmentId, chatId)).remoteBlob; }
  async read(attachmentId: string, chatId: string): Promise<string> { return (await this.library.read(attachmentId, chatId)).dataUrl; }
}
