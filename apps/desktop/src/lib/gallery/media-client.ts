/**
 * [INPUT]: Depends on shared GalleryMediaBridgeApi and preload window.galleryMedia
 * [OUTPUT]: Declares window.galleryMedia's renderer-side type; callers read it directly and degrade immediately when it is absent
 * [POS]: The IPC type declaration for src/lib/gallery; components never touch the Electron channel directly
 */

import type { GalleryMediaBridgeApi } from "../../../shared/gallery-media-ipc";

declare global {
  interface Window {
    galleryMedia?: GalleryMediaBridgeApi;
  }
}
