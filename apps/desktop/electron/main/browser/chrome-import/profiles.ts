/**
 * [INPUT]: Depends on only reading fs/path and Chrome Local State profile.info_cache
 * [OUTPUT]: Provides detectChromeProfiles and resolveChromeProfilePath; returns an empty list when Chrome's Local State is missing or malformed
 * [POS]: browser/chrome-import's profile-detection and path-containment layer; never writes to a Chrome profile directory
 */

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import {
  chromeProfileDirectorySchema,
  type ChromeProfile,
} from "../../../../shared/browser-import-ipc";

export async function detectChromeProfiles(
  chromeRoot: string
): Promise<ChromeProfile[]> {
  try {
    const raw = await readFile(resolve(chromeRoot, "Local State"), "utf8");
    const parsed = JSON.parse(raw) as {
      profile?: { info_cache?: Record<string, { name?: unknown }> };
    };
    const cache = parsed.profile?.info_cache;
    if (!cache || typeof cache !== "object") return [];
    const profiles: ChromeProfile[] = [];
    for (const [directory, value] of Object.entries(cache)) {
      if (!chromeProfileDirectorySchema.safeParse(directory).success) continue;
      const path = resolveChromeProfilePath(chromeRoot, directory);
      if (!(await isDirectory(path))) continue;
      profiles.push({
        directory,
        name:
          typeof value?.name === "string" && value.name.trim()
            ? value.name.trim()
            : directory,
      });
    }
    return profiles.sort(
      (left, right) =>
        profileOrder(left.directory) - profileOrder(right.directory)
    );
  } catch {
    return [];
  }
}

export function resolveChromeProfilePath(
  chromeRoot: string,
  profileDirectory: string
) {
  const directory = chromeProfileDirectorySchema.parse(profileDirectory);
  const root = resolve(chromeRoot);
  const target = resolve(root, directory);
  if (!target.startsWith(`${root}/`)) {
    throw new Error("Chrome profile 路径越界");
  }
  return target;
}

async function isDirectory(path: string) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

const profileOrder = (directory: string) =>
  directory === "Default"
    ? 0
    : Number(directory.slice("Profile ".length)) || Number.MAX_SAFE_INTEGER;
