/**
 * [INPUT]: Depends on Electron app.isPackaged, main-owned PresetCatalog sourceDirectory/URL/pin, and dev submodules
 * [OUTPUT]: Provides PresetSourceResolver; release uses canonical URL+pin, dev uses repository-aligned submodule directory+live HEAD
 * [POS]: The default for apps/share/preset is to have the hard border of the source channel; env/argv/Settings/IPC is not part of the packaged branch
 */

import { execFile } from "node:child_process";
import { app } from "electron";
import { join } from "node:path";
import { promisify } from "node:util";
import type { PresetCatalog } from "../../../preset-catalog";

const execFileAsync = promisify(execFile);

export type ResolvedPresetSource = Readonly<{
  presetId: string;
  cloneLocator: string;
  expectedCommitSha: string;
  channel: "release" | "dev";
}>;

type ResolverOptions = {
  isPackaged?: () => boolean;
  devAppsRoot?: () => string;
  resolveGitHead?: (path: string) => Promise<string>;
};

export class PresetSourceResolver {
  private readonly isPackaged: () => boolean;
  private readonly devAppsRoot: () => string;
  private readonly resolveGitHead: (path: string) => Promise<string>;

  constructor(
    private readonly catalog: PresetCatalog,
    options: ResolverOptions = {}
  ) {
    this.isPackaged = options.isPackaged ?? (() => app.isPackaged);
    this.devAppsRoot =
      options.devAppsRoot ??
      (() => join(__dirname, "..", "..", "resources", "apps"));
    this.resolveGitHead = options.resolveGitHead ?? gitHead;
  }

  async resolve(presetId: string): Promise<ResolvedPresetSource> {
    const entry = this.catalog.require(presetId);
    if (this.isPackaged()) {
      return {
        presetId,
        cloneLocator: entry.canonicalRepoUrl,
        expectedCommitSha: entry.catalogPin,
        channel: "release",
      };
    }
    const cloneLocator = join(this.devAppsRoot(), entry.sourceDirectory);
    return {
      presetId,
      cloneLocator,
      expectedCommitSha: await this.resolveGitHead(cloneLocator),
      channel: "dev",
    };
  }
}

async function gitHead(path: string) {
  const { stdout } = await execFileAsync("git", ["-C", path, "rev-parse", "HEAD"], {
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 64 * 1024,
  });
  const sha = stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("预设 submodule HEAD 无效");
  return sha;
}
