/**
 * [INPUT]: Main-owned preset catalog, bounded release descriptors and existing Git/package admission.
 * [OUTPUT]: A canonical repository source provider bound to commit and package digests, trusting GitHub infrastructure.
 * [POS]: Independent update trust boundary; Settings, environment and renderer cannot select URLs or commits.
 */
import { dirname } from "node:path";
import type { PresetCatalog } from "../../presets/preset-catalog";
import { RepoProbeService } from "../share/package/repo-probe";
import { copyPackage, inspectPackage, packageDigest, removePackageArtifact } from "../share/package/package-contract";
import { signedUpdateSchema, type SignedUpdate } from "./contract";
export interface UpdateSource {
  available?(): boolean;
  fetch(presetId: string, target: string): Promise<SignedUpdate>;
  verify(signed: SignedUpdate, presetId: string, now?: number): void;
}
export function verifyUpdateDescriptor(value: unknown, presetId: string, now = Date.now()): SignedUpdate {
  const signed = signedUpdateSchema.parse(value), descriptor = signed.descriptor;
  if (descriptor.presetId !== presetId) throw new Error("APP_UPDATE_IDENTITY_INVALID");
  if (descriptor.publishedAt > now + 300_000 || descriptor.expiresAt <= now || descriptor.expiresAt <= descriptor.publishedAt) {
    throw new Error("APP_UPDATE_DESCRIPTOR_EXPIRED");
  }
  return signed;
}
export class PresetUpdateSource implements UpdateSource {
  private readonly probes: RepoProbeService;
  constructor(userData: string, private readonly catalog: PresetCatalog) { this.probes = new RepoProbeService(userData); }
  available() { return true; }
  verify(signed: SignedUpdate, presetId: string, now?: number) { verifyUpdateDescriptor(signed, presetId, now); }
  async fetch(presetId: string, target: string) {
    const entry = this.catalog.require(presetId);
    const repository = entry.canonicalRepoUrl.replace(/\.git$/, "");
    const response = await fetch(`${repository}/releases/latest/download/bottega-update.json`, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok || !response.body) throw new Error("APP_UPDATE_DESCRIPTOR_UNAVAILABLE");
    const chunks: Uint8Array[] = []; let bytes = 0;
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > 16_384) { await reader.cancel(); throw new Error("APP_UPDATE_DESCRIPTOR_TOO_LARGE"); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const signed = verifyUpdateDescriptor(JSON.parse(Buffer.concat(chunks).toString("utf8")), presetId);
    const result = await this.probes.probe(entry.canonicalRepoUrl, signed.descriptor.sourceCommitSha, presetId);
    if (result.kind === "compatibility-blocked") throw new Error(result.compatibility.code);
    if (result.kind !== "base") throw new Error("APP_UPDATE_BASE_REQUIRED");
    let consumedRoot: string | undefined;
    try {
      if (`sha256:${result.digest}` !== signed.descriptor.packageDigest || result.extensionPreflights.length) throw new Error("APP_UPDATE_PACKAGE_INVALID");
      consumedRoot = this.probes.consume(result.preflightId, result.digest, entry.canonicalRepoUrl).packageRoot;
      await copyPackage(consumedRoot, target);
      if (`sha256:${await packageDigest(target, (await inspectPackage(target)).files)}` !== signed.descriptor.packageDigest) throw new Error("APP_UPDATE_PACKAGE_CHANGED");
      return signed;
    } finally {
      await this.probes.discard(result.preflightId);
      if (consumedRoot) await removePackageArtifact(dirname(consumedRoot));
    }
  }
}
