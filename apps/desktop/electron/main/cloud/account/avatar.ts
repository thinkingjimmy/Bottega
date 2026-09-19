/**
 * [INPUT]: Depends on bounded Google image downloads and an account-scoped atomic cache in userData.
 * [OUTPUT]: Provides offline avatars, deduplicated refresh, cancellation and serialized cache clearing.
 * [POS]: Main-only avatar owner; renderer receives image bytes and never performs a profile network request.
 */
import { mkdir, readFile, writeFile, rename, unlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { downloadGoogleAvatar, googleAvatarUrl, MAX_AVATAR_BYTES } from "@ai-chat/cloud-protocol";
type Profile = { userId: string; avatarUrl?: string | null };
type Cached = { userId: string; url: string; dataUrl: string; refreshedAt: number };
const lifetime = 7 * 24 * 60 * 60_000;
const dataUrlPattern = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;
export class AccountAvatarCache {
  private key: string | null = null;
  private generation = 0;
  private nextAttempt = 0;
  private active: AbortController | null = null;
  private writes: Promise<void> = Promise.resolve();
  private flight: Promise<void> = Promise.resolve();
  private readonly file: string;
  constructor(private readonly root: string, private readonly request: typeof fetch = fetch) { this.file = join(root, "cloud-avatar.json"); }
  select(profile: Profile | null, changed: (value: string | null) => void) {
    const url = googleAvatarUrl(profile?.avatarUrl), key = profile && url ? JSON.stringify([profile.userId, url]) : null;
    if (key === this.key && (key === null ? this.generation > 0 : Date.now() < this.nextAttempt)) return;
    const same = key === this.key; this.key = key; this.nextAttempt = Infinity;
    const generation = ++this.generation; this.active?.abort(); this.active = null; if (!same) changed(null);
    if (!profile || !url) {
      this.writes = this.writes.then(() => unlink(this.file).catch(error => { if (error.code !== "ENOENT") throw error; })).catch(() => {});
      this.flight = this.writes; return;
    }
    const controller = new AbortController(); this.active = controller;
    const current = () => this.generation === generation && !controller.signal.aborted;
    this.flight = (async () => {
      await this.writes;
      let cached: Cached | null = null;
      try {
        if ((await stat(this.file)).size <= MAX_AVATAR_BYTES * 2) {
          const value = JSON.parse(await readFile(this.file, "utf8")) as Cached;
          if (value.userId === profile.userId && value.url === url && typeof value.dataUrl === "string" && value.dataUrl.length <= 350_000 && dataUrlPattern.test(value.dataUrl) &&
            Number.isFinite(value.refreshedAt) && value.refreshedAt <= Date.now()) cached = value;
        }
      } catch { /* A damaged cache never blocks authentication. */ }
      if (!current()) return;
      if (cached) { changed(cached.dataUrl); if (Date.now() - cached.refreshedAt < lifetime) { this.nextAttempt = cached.refreshedAt + lifetime; return; } }
      const timeout = setTimeout(() => controller.abort(), 10_000); timeout.unref();
      try {
        const image = await downloadGoogleAvatar(url, controller.signal, this.request); if (!current()) return;
        const dataUrl = `data:${image.mime};base64,${Buffer.from(image.bytes).toString("base64")}`;
        const value: Cached = { userId: profile.userId, url, dataUrl, refreshedAt: Date.now() };
        this.nextAttempt = value.refreshedAt + lifetime;
        changed(dataUrl);
        this.writes = this.writes.then(async () => {
          if (!current()) return;
          await mkdir(this.root, { recursive: true }); const temporary = this.file + "." + randomUUID();
          try {
            await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
            if (current()) await rename(temporary, this.file);
          } finally { await unlink(temporary).catch(() => {}); }
        }).catch(() => {});
        await this.writes;
      } catch { if (this.generation === generation) this.nextAttempt = Date.now() + 60_000; }
      finally { clearTimeout(timeout); }
    })();
  }
  settled() { return this.flight; }
  close() { this.generation++; this.active?.abort(); this.active = null; }
}
