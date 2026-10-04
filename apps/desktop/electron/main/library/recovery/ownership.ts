/**
 * [INPUT]: Read-only known Bottega profile settings and the portable publisher hint.
 * [OUTPUT]: Names a selected folder's known installation/profile or publishing computer without inventing ownership.
 * [POS]: Recovery explanation only; LibraryService remains the authority for admission.
 */
import { lstat, opendir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { readPublisher } from "../publisher";

export async function describeLibraryOwner(root: string, libraryId: string, appData: string): Promise<{ installation?: string; host?: string }> {
  const publisher = await readPublisher(root);
  for (const installation of ["Bottega", "Bottega Cloud Dev", "Bottega Source Dev", "@ai-chat/desktop"]) {
    const base = join(appData, installation), profiles = [{ path: base, label: installation }];
    const directory = await opendir(join(base, "profiles")).catch(() => null);
    if (directory) {
      try {
        for (let count = 0; count < 32; count++) {
          const entry = await directory.read(); if (!entry) break;
          if (entry.isDirectory() && !entry.isSymbolicLink()) profiles.push({ path: join(base, "profiles", entry.name), label: `${installation} · ${entry.name}` });
        }
      } finally { await directory.close().catch(() => {}); }
    }
    for (const profile of profiles) {
      try {
        const path = join(profile.path, "settings.json"), info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) continue;
        const settings = JSON.parse(await readFile(path, "utf8")).settings;
        if (settings?.libraryId === libraryId) return { installation: profile.label, host: publisher?.host };
      } catch { /* An unreadable profile supplies no ownership evidence. */ }
    }
  }
  return { host: publisher?.host };
}
