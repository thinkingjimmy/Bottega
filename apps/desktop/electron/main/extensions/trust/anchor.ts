/**
 * [INPUT]: Depends on node:fs/path only.
 * [OUTPUT]: Provides the embedded-only readTrustAnchor, TrustAnchorRead and EMBEDDED_ANCHOR_RELATIVE.
 * [POS]: extensions/trust's reader of the shipped root and metadata source; unreadable content remains unavailable to the verifier.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";


/** Where the shipped anchor lives in the source tree; packaged, it is <resources>/extension-trust/root.json. */
export const EMBEDDED_ANCHOR_RELATIVE = "resources/extension-trust/root.json";

const readJson = (path: string): unknown => { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; } };

/**
 * The anchor as read: raw JSON for the verifier to parse strictly (null when unreadable, which it refuses). `resourcesRoot` is the
 * directory holding extension-trust/: the app's resources when packaged, apps/desktop/resources in development.
 */
export type TrustAnchorRead = { anchor: unknown; source: "embedded"; diagnostic?: string;
  metadataSource?: unknown;
  
   };

export function readTrustAnchor(input: { isPackaged: boolean; env: NodeJS.ProcessEnv; resourcesRoot: string }): TrustAnchorRead {
  const anchor = readJson(join(input.resourcesRoot, "extension-trust", "root.json"));
  return { anchor, source: "embedded", metadataSource: readJson(join(input.resourcesRoot, "extension-trust", "source.json")) };
}
