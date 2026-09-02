/**
 * [INPUT]: Depends on Node Ed25519 verification, bounded HTTPS fetch, and the shared strict App GUI support-matrix schema
 * [OUTPUT]: Provides exact-byte detached-signature verification and GitHub release-asset loading for candidate compatibility preflight
 * [POS]: Update supply-chain boundary; UpdateService receives only a verified matrix and never parses unsigned candidate policy
 */

import { createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  appGuiCompatibilitySupportSchema,
  type AppGuiCompatibilitySupport,
} from "../../../shared/app-gui/support";

const MATRIX_BYTES_LIMIT = 64 * 1024;
const SIGNATURE_BYTES = 64;
const RELEASE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const MATRIX_ASSET = "app-gui-compatibility-support.json";

export type CandidateCompatibilityLoader = (
  version: string
) => Promise<AppGuiCompatibilitySupport>;

export async function verifyCandidateCompatibility(input: Readonly<{
  matrixBytes: Uint8Array;
  signatureBytes: Uint8Array;
  publicKeyPem: string | Buffer;
}>): Promise<AppGuiCompatibilitySupport> {
  if (input.matrixBytes.byteLength > MATRIX_BYTES_LIMIT) {
    throw new Error("GUI_COMPATIBILITY_MATRIX_TOO_LARGE");
  }
  if (input.signatureBytes.byteLength !== SIGNATURE_BYTES) {
    throw new Error("GUI_COMPATIBILITY_SIGNATURE_INVALID");
  }
  const publicKey = createPublicKey(input.publicKeyPem);
  if (publicKey.asymmetricKeyType !== "ed25519") {
    throw new Error("GUI_COMPATIBILITY_PUBLIC_KEY_INVALID");
  }
  if (!verify(null, input.matrixBytes, publicKey, input.signatureBytes)) {
    throw new Error("GUI_COMPATIBILITY_SIGNATURE_INVALID");
  }
  const source = new TextDecoder("utf-8", { fatal: true }).decode(input.matrixBytes);
  return appGuiCompatibilitySupportSchema.parse(JSON.parse(source));
}

export function createGitHubCompatibilityLoader(
  resourcesPath: string,
  fetchImpl: typeof fetch = fetch
): CandidateCompatibilityLoader {
  let publicKey: Promise<Buffer> | null = null;
  return async (version) => {
    if (!RELEASE_VERSION.test(version)) {
      throw new Error("GUI_COMPATIBILITY_VERSION_INVALID");
    }
    publicKey ??= readFile(
      join(resourcesPath, "app-gui-toolchain", "release-public-key.pem")
    ).catch((cause) => {
      publicKey = null;
      throw new Error("GUI_COMPATIBILITY_RELEASE_KEY_UNAVAILABLE", { cause });
    });
    const prefix = `https://github.com/thinkingjimmy/Bottega/releases/download/v${version}`;
    const [matrixBytes, signatureBytes, publicKeyPem] = await Promise.all([
      fetchBounded(fetchImpl, `${prefix}/${MATRIX_ASSET}`, MATRIX_BYTES_LIMIT),
      fetchBounded(fetchImpl, `${prefix}/${MATRIX_ASSET}.sig`, SIGNATURE_BYTES),
      publicKey,
    ]);
    return verifyCandidateCompatibility({ matrixBytes, signatureBytes, publicKeyPem });
  };
}

async function fetchBounded(
  fetchImpl: typeof fetch,
  url: string,
  limit: number
): Promise<Uint8Array> {
  const response = await fetchImpl(url, {
    headers: { accept: "application/octet-stream" },
    redirect: "follow",
  });
  if (!response.ok || !trustedReleaseUrl(response.url)) {
    throw new Error("GUI_COMPATIBILITY_ASSET_UNAVAILABLE");
  }
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > limit) throw new Error("GUI_COMPATIBILITY_ASSET_TOO_LARGE");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > limit) throw new Error("GUI_COMPATIBILITY_ASSET_TOO_LARGE");
  return bytes;
}

function trustedReleaseUrl(value: string) {
  const url = new URL(value);
  return url.protocol === "https:" && (
    url.hostname === "github.com" ||
    url.hostname.endsWith(".githubusercontent.com")
  );
}
