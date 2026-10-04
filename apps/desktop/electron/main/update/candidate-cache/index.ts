/**
 * [INPUT]: Depends on Updater download metadata, candidate version, file identity, and SHA-512 bytes.
 * [OUTPUT]: Provides a candidate cache that rejects missing, replaced, or corrupt downloads before safe quit.
 * [POS]: Update installation boundary between downloaded readiness and terminal installer handoff.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";

type Downloaded = { version?: string; downloadedFile: string; files: readonly { url: string; sha512: string; size?: number }[] };
export class CandidateCache {
  private candidate: { version?: string; path: string; sha512: string; size?: number } | null = null;
  capture(event: Downloaded) {
    const filename = basename(event.downloadedFile);
    const file = event.files.find((file) => basename(new URL(file.url, "https://update.invalid/").pathname) === filename);
    this.candidate = file ? { version: event.version, path: event.downloadedFile, sha512: file.sha512, size: file.size } : null;
  }
  invalidate() { this.candidate = null; }
  async valid(version?: string) {
    const candidate = this.candidate;
    if (!candidate || (version && candidate.version !== version)) return false;
    try {
      const metadata = await stat(candidate.path);
      if (!metadata.isFile() || metadata.size === 0 || (candidate.size !== undefined && metadata.size !== candidate.size)) return false;
      const hash = createHash("sha512");
      for await (const chunk of createReadStream(candidate.path)) hash.update(chunk);
      return candidate === this.candidate && hash.digest("base64") === candidate.sha512;
    } catch { return false; }
  }
}
