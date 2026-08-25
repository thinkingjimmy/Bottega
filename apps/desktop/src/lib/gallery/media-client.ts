/**
 * [INPUT]: Depends on shared GalleryMediaBridgeApi and preload window.galleryMedia
 * [OUTPUT]: Declare renderer: the type of the global Gallery Media Port (the consumer directly reads window.galleryMedia, absent is immediately downgraded)
 * [POS]: The IPC type of the src/lib/gallery connector; The components do not directly contact the Electron channel
 */

import type { GalleryMediaBridgeApi } from "../../../shared/gallery-media-ipc";

declare global {
  interface Window {
    galleryMedia?: GalleryMediaBridgeApi;
  }
}
