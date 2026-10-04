/**
 * [INPUT]: Depends on Electron app.isPackaged, main-owned PresetCatalog sourceDirectory/URL/pin, dev submodules, and the product Git boundary (runGit)
 * [OUTPUT]: Provides PresetSourceResolver and presetGitHead; release uses canonical URL+pin, dev uses repository-aligned submodule directory+live HEAD
 * [POS]: apps/share/preset source-channel boundary; packaged builds resolve only from the catalog, never from env/argv/Settings/IPC overrides
 */

import { app } from "electron";
import { join } from "node:path";
import type { PresetCatalog } from "../../../presets/preset-catalog";
import { runGit } from "../../../projects/git/git-runner";

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
    this.resolveGitHead = options.resolveGitHead ?? presetGitHead;
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

/* Through the product's Git boundary: it strips every inherited GIT_* variable, so a stray GIT_DIR cannot turn "read repo A" into "read repo B". */
export async function presetGitHead(path: string) {
  const sha = (await runGit(path, ["rev-parse", "HEAD"], { timeoutMs: 10_000, maxBytes: 64 * 1024 })).trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("预设 submodule HEAD 无效");
  return sha;
}
