/**
 * [INPUT]: Depends on An owned userData file, installed candidate version, and the current clock.
 * [OUTPUT]: Provides bounded single-use expiring update visibility intent.
 * [POS]: Presence restart handoff; normal activation remains authoritative over silent restoration.
 */

import { readFile, stat, unlink, writeFile } from "node:fs/promises";
export class RestartPresentation {
  constructor(private readonly path: string, private readonly now = Date.now) {}
  async save(version: string, hidden: boolean) {
    await writeFile(this.path, JSON.stringify({ version, hidden, expiresAt: this.now() + 300_000 }), { mode: 0o600 });
  }
  async clear() { await unlink(this.path).catch((cause) => { if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause; }); }
  async consume(version: string): Promise<boolean> {
    try {
      const metadata = await stat(this.path); if (metadata.size > 4096) { await this.clear(); return false; }
      const value = JSON.parse(await readFile(this.path, "utf8")); await this.clear();
      return value.version === version && value.hidden === true && Number.isFinite(value.expiresAt) &&
        value.expiresAt > this.now() && value.expiresAt <= this.now() + 300_000;
    } catch { return false; }
  }
}
