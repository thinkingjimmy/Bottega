/**
 * [INPUT]: Depends on nothing.
 * [OUTPUT]: Provides the native Base image and Gallery media channel names.
 * [POS]: Zod-free IPC channel names (OPT-34): preload imports these so no schema module enters its bundle; the owning contract modules re-export them unchanged.
 */
export const BASE_IMAGE_CHANNEL = { begin: "bases:image-begin", part: "bases:image-part", finish: "bases:image-finish",
  cancel: "bases:image-cancel", commitRecord: "bases:record-commit", thumbnail: "bases:image-thumbnail" } as const;

export const GALLERY_MEDIA_CHANNEL = {
  thumbnail: "gallery-media:thumbnail",
  materialize: "gallery-media:materialize",
  event: "gallery-media:event",
} as const;
