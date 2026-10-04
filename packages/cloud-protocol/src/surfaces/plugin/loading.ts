/**
 * [INPUT]: An R-26 head, a verified encrypted-file reader (the browser blob transfer in production) and the manifest check from cloud-protocol.
 * [OUTPUT]: loadSurfaceGeneration (decrypt the manifest, cross-check it with the head, decrypt every file) and SurfaceUnavailable (the status to show).
 * [POS]: Shared verified App/plugin generation reader for browsers and native remote Surfaces. Nothing is cached or written anywhere.
 */
import type { EncryptedFileDescriptor } from "../../blobs/encrypted/model";
import { checkAppSurfaceManifest } from "../encrypted";
import type { AppSurfaceHead, AppSurfaceManifest } from "../manifest";
import { checkPluginSurfaceManifest, type PluginSurfaceHead, type PluginSurfaceManifest } from "./model";
import type { SurfaceMount } from "../frame-protocol";

/** Reads one encrypted file and returns its plaintext; implementations verify every part and the plaintext hash (openEncryptedFile). */
export type SurfaceFileReader = (descriptor: EncryptedFileDescriptor, signal: AbortSignal) => Promise<Uint8Array>;
export class SurfaceUnavailable extends Error {
  constructor(readonly status: "unsupported-layout" | "revoked" | "missing-resources") { super(status); }
}
const CONCURRENCY = 4;
export async function loadSurfaceGeneration(head: AppSurfaceHead, read: SurfaceFileReader, signal: AbortSignal): Promise<{manifest:AppSurfaceManifest;files:SurfaceMount["files"]}>;
export async function loadSurfaceGeneration(head: PluginSurfaceHead, read: SurfaceFileReader, signal: AbortSignal): Promise<{manifest:PluginSurfaceManifest;files:SurfaceMount["files"]}>;
export async function loadSurfaceGeneration(head: AppSurfaceHead | PluginSurfaceHead, read: SurfaceFileReader, signal: AbortSignal):
  Promise<{ manifest: AppSurfaceManifest | PluginSurfaceManifest; files: SurfaceMount["files"] }> {
  if (head.state === "unsupported") throw new SurfaceUnavailable("unsupported-layout");
  if (head.state === "retired") throw new SurfaceUnavailable("revoked");
  try {
    const bytes = await read(head.manifest, signal);
    const manifest = "subject" in head ? checkPluginSurfaceManifest(head, bytes) : checkAppSurfaceManifest(head, bytes);
    const files = new Array<SurfaceMount["files"][number]>(manifest.files.length);
    let next = 0;
    // The manifest bound each blob to its path, size and hash; the reader verified the bytes against that hash.
    const worker = async () => {
      for (let index = next++; index < manifest.files.length; index = next++) {
        const item = manifest.files[index]!, bytes = await read(item.file, signal);
        if (bytes.byteLength !== item.bytes) throw new Error("app-surface-file-size");
        files[index] = { path: item.path, mime: item.mime, bytes };
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, manifest.files.length) }, worker));
    return { manifest, files };
  } catch (error) {
    signal.throwIfAborted();
    // Integrity, a missing part or a head that disagrees with its manifest all mean: do not mount any of it.
    throw error instanceof SurfaceUnavailable ? error : new SurfaceUnavailable("missing-resources");
  }
}
