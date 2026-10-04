/**
 * [INPUT]: Startup-owned PreviewFeature lifetime.
 * [OUTPUT]: installPreviewFeature and previewFeature for narrow tool, IPC and cloud composition.
 * [POS]: Main-only composition cell; application and sandbox frames cannot access it.
 */
import type { PreviewFeature } from "./composition";
let installed: PreviewFeature | null = null;
export const previewFeature = () => installed;
export function installPreviewFeature(value: PreviewFeature | null) { installed = value; }
