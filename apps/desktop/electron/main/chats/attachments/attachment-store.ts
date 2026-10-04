/**
 * [INPUT]: Depends on the selected folder root getter and the shared chats/agent attachment contracts
 * [OUTPUT]: Provides verified attachment bytes, a downscaled transcript thumbnail, logical identity and the retained encrypted remote descriptor.
 * [POS]: apps/desktop/electron/main/chats/attachments; Attachment byte owner of the chats module; bytes live in the folder beside their Chat and only ChatsService consumes them
 */

import type { ChatAttachmentMeta, ChatAttachmentPayload } from "../../../../shared/ipc/content/chats-ipc";
import { LibraryAttachments } from "../../library/assets/attachments";
import { sharedThumbnailCache } from "../../bases/store/thumbnail-cache";

/* 64 px chips at up to 2.5x density; the side panel still reads the full image. */
const THUMBNAIL_EDGE = 160;

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
  /** The transcript shows a 64 px chip, so it gets a downscaled PNG instead of up to 8 MiB of original (C-19). */
  async thumbnail(attachmentId: string, chatId: string): Promise<string> {
    const { dataUrl } = await this.library.read(attachmentId, chatId);
    const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
    return (await sharedThumbnailCache().get(`chat/${chatId}/${attachmentId}/${THUMBNAIL_EDGE}`, bytes, THUMBNAIL_EDGE)).dataUrl;
  }
}
