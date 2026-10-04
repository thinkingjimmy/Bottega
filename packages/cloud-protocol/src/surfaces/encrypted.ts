/**
 * [INPUT]: The R-26 manifest and head contracts, the generic encrypted-file reader and the file cipher port.
 * [OUTPUT]: appSurfaceManifestIdentity (the sealing identity the owner desktop uses), openAppSurfaceManifest (decrypt, parse and cross-check against the head) and checkAppSurfaceManifest (the same check on bytes a transfer already decrypted).
 * [POS]: R-26 codec shared by the desktop publisher and the Cloud Web reader; the key never leaves the cipher port.
 */
import { openEncryptedFile } from "../blobs/encrypted/client";
import type { EncryptedFileIdentity, EncryptedFilePart, FileCipherPort } from "../blobs/encrypted/model";
import { assertCrypto } from "../encryption";
import type { EncryptedSpace } from "../spaces";
import { APP_SURFACE_LIMITS, appSurfaceManifestSchema, type AppSurfaceHead, type AppSurfaceManifest } from "./manifest";

export function appSurfaceManifestIdentity(encryptedSpace: EncryptedSpace, appId: string, generationId: string, blobId: string, operationId: string,
  chunkCount = 1): EncryptedFileIdentity {
  return { encryptedSpace, domain: "app-surface-generation", blobId, owner: { kind: "app", id: appId }, ownerGeneration: generationId,
    manifestId: blobId, operationId, chunkCount };
}
/** Opens a published head's manifest. The sealed context binds App and generation; the plaintext head must agree with the sealed manifest. */
export async function openAppSurfaceManifest(head: Extract<AppSurfaceHead, { state: "published" }>, crypto: FileCipherPort,
  read: (part: EncryptedFilePart, signal: AbortSignal) => Promise<Uint8Array>, signal: AbortSignal): Promise<AppSurfaceManifest> {
  const sealed = head.manifest.encryption;
  assertCrypto(sealed.domain === "app-surface-generation" && sealed.owner.kind === "app" && sealed.owner.id === head.appId &&
    sealed.ownerGeneration === head.generationId && head.manifest.bytes <= APP_SURFACE_LIMITS.manifestBytes);
  const chunks: Uint8Array[] = [];
  const bytes = await openEncryptedFile(head.manifest, crypto, read, {
    write: async chunk => { chunks.push(chunk); },
    commit: async () => { const joined = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)); let offset = 0;
      for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; } return joined; },
    abort: async () => { chunks.length = 0; },
  }, signal, "foreground");
  return checkAppSurfaceManifest(head, bytes);
}
/** Parses decrypted manifest bytes and requires the plaintext head to agree with the sealed body (digest, counts, App and generation). */
export function checkAppSurfaceManifest(head: Extract<AppSurfaceHead, { state: "published" }>, bytes: Uint8Array): AppSurfaceManifest {
  const manifest = appSurfaceManifestSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  if (manifest.appId !== head.appId || manifest.generationId !== head.generationId || manifest.artifactDigest !== head.artifactDigest ||
    manifest.files.length !== head.fileCount || manifest.files.reduce((sum, item) => sum + item.bytes, 0) !== head.byteSize) throw new Error("app-surface-head-mismatch");
  return manifest;
}
