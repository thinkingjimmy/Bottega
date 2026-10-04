/**
 * [INPUT]: Depends on nanoid, shared SurfaceComposerImage/SurfaceImageTransfer DTOs, and the draft file and QueuedAttachment shapes
 * [OUTPUT]: Provides fileSource/attachmentSource, ComposerImageExport (reads draft/queue image bytes for one migration and stashes them by transaction), takeComposerImageTransfers,
 *           and receivedImages, which rebuilds a draft ComposerFile or a queued attachment from accepted bytes
 * [POS]: chat-composer's F-34(b) image carrier: the capsule holds only image metadata; the bytes ride beside it through main, which forwards only valid ones
 */

import { nanoid } from "nanoid";
import type { GalleryAttachmentOrigin } from "@ai-chat/ui/hooks/use-attachment-list";
import type { SurfaceComposerImage, SurfaceImageTransfer } from "../../../shared/ipc/settings/window-surfaces-ipc";
import type { QueuedAttachment } from "../chat/session/message-queue-model";
import type { ComposerFile } from "../chat/state/composer/chat-composer-store";

type ImageSource = Readonly<{ id: string; name: string; mediaType: string; origin?: GalleryAttachmentOrigin; nativeFile?: File; url?: string }>;
type ComposerImageFile = Readonly<{
  id: string; type: "file"; mediaType: string; filename: string; url: string; nativeFile: File; origin?: GalleryAttachmentOrigin;
}>;

export const fileSource = (file: ComposerFile): ImageSource => ({
  id: file.id, name: file.filename ?? "image", mediaType: file.mediaType, origin: file.origin, nativeFile: file.nativeFile, url: file.url,
});
export const attachmentSource = (attachment: QueuedAttachment): ImageSource => ({
  id: attachment.id, name: attachment.name, mediaType: attachment.mediaType, origin: attachment.origin,
  ...(attachment.kind === "handle" ? { nativeFile: attachment.nativeFile } : { url: attachment.dataUrl }),
});

const stash = new Map<string, SurfaceImageTransfer[]>();

async function readBytes(source: ImageSource) {
  try {
    if (source.nativeFile) return new Uint8Array(await source.nativeFile.arrayBuffer());
    const comma = source.url?.startsWith("data:") ? source.url.indexOf(",") : -1;
    if (comma < 0 || !source.url!.slice(0, comma).endsWith(";base64")) return null;
    return Uint8Array.from(atob(source.url!.slice(comma + 1)), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Reads every image once, before the synchronous snapshot, so a slow read cannot tear the capsule. */
export class ComposerImageExport {
  private readonly bytes = new Map<string, Uint8Array | null>();
  private readonly transfers: SurfaceImageTransfer[] = [];

  async read(sources: readonly ImageSource[]) {
    for (const source of sources) this.bytes.set(sourceKey(source), await readBytes(source));
  }

  /** null = could not be read; the caller shows it unavailable (draft) or fences its message (queue). */
  carry(source: ImageSource, sketch: boolean): SurfaceComposerImage | null {
    const bytes = this.bytes.get(sourceKey(source));
    if (!bytes) return null;
    const transferId = nanoid();
    this.transfers.push({ transferId, bytes });
    // A Sketch's editable source does not move, so its image moves as a plain image under a new id.
    const id = sketch ? nanoid() : source.id;
    return { id, transferId, name: source.name, mediaType: source.mediaType, ...(source.origin ? { origin: structuredClone(source.origin) } : {}) };
  }

  stash(transactionId: string) {
    stash.set(transactionId, this.transfers);
  }
}

const sourceKey = (source: ImageSource) => `${source.id}\u0000${source.url ?? ""}\u0000${source.nativeFile?.size ?? ""}`;

/** The window-surfaces client hands these to main with the exported capsule; taking them ends the renderer's copy. */
export function takeComposerImageTransfers(transactionId: string) {
  const transfers = stash.get(transactionId) ?? [];
  stash.delete(transactionId);
  return transfers;
}

export function receivedImages(transfers: readonly SurfaceImageTransfer[] = []) {
  const bytes = new Map(transfers.map((transfer) => [transfer.transferId, transfer.bytes]));
  const file = (image: SurfaceComposerImage) => {
    const data = bytes.get(image.transferId);
    return data ? new File([data as Uint8Array<ArrayBuffer>], image.name, { type: image.mediaType }) : null;
  };
  const origin = (image: SurfaceComposerImage) => image.origin ? { origin: image.origin as GalleryAttachmentOrigin } : {};
  return {
    draftFile(image: SurfaceComposerImage): ComposerImageFile | null {
      const nativeFile = file(image);
      return nativeFile && { id: image.id, type: "file", mediaType: image.mediaType, filename: image.name, url: URL.createObjectURL(nativeFile), nativeFile, ...origin(image) };
    },
    queuedAttachment(image: SurfaceComposerImage): QueuedAttachment | null {
      const nativeFile = file(image);
      return nativeFile && { kind: "handle", id: image.id, nativeFile, name: image.name, mediaType: image.mediaType, size: nativeFile.size, ...origin(image) };
    },
  };
}
