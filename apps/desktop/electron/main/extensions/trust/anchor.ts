/**
 * [INPUT]: Depends on node:fs/path only.
 * [OUTPUT]: Provides readTrustAnchor and TrustAnchorRead (the embedded anchor, or in an unpackaged run the test anchor named by TEST_ANCHOR_ENV with its directory), TEST_ANCHOR_ENV and EMBEDDED_ANCHOR_RELATIVE.
 * [POS]: extensions/trust's only reader of the test-anchor variable (a guard test fails if any other main file names it). A packaged build, whatever its flavour, reads only what it ships and reports the variable as a named diagnostic; the anchor itself ships unprovisioned until Jimmy's key ceremony.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** A test anchor for test mode: honoured only by a development run, never by a packaged build. */
export const TEST_ANCHOR_ENV = "BOTTEGA_E2E_EXTENSION_TRUST_ANCHOR";
/** Where the shipped anchor lives in the source tree; packaged, it is <resources>/extension-trust/root.json. */
export const EMBEDDED_ANCHOR_RELATIVE = "resources/extension-trust/root.json";

const readJson = (path: string): unknown => { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; } };

/**
 * The anchor as read: raw JSON for the verifier to parse strictly (null when unreadable, which it refuses). `resourcesRoot` is the
 * directory holding extension-trust/: the app's resources when packaged, apps/desktop/resources in development.
 */
export type TrustAnchorRead = { anchor: unknown; source: "embedded" | "test-override"; diagnostic?: string;
  metadataSource?: unknown;
  /** Test mode only: the test anchor's directory, where the test snapshot lives. */
  directory?: string };

export function readTrustAnchor(input: { isPackaged: boolean; env: NodeJS.ProcessEnv; resourcesRoot: string }): TrustAnchorRead {
  const override = input.env[TEST_ANCHOR_ENV];
  if (override && !input.isPackaged) return { anchor: readJson(override), source: "test-override", directory: dirname(override) };
  const anchor = readJson(join(input.resourcesRoot, "extension-trust", "root.json"));
  return { anchor, source: "embedded", metadataSource: readJson(join(input.resourcesRoot, "extension-trust", "source.json")),
    ...(override ? { diagnostic: `extension-trust-test-anchor-refused: ${TEST_ANCHOR_ENV} is ignored by a packaged build` } : {}) };
}
