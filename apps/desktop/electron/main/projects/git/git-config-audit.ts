/**
 * [INPUT]: Depends on the bounded Git runner and Git's NUL-delimited effective-config projection
 * [OUTPUT]: Provides parsed effective Git config and explicit blockers for repository-controlled executable hooks used by the v1 command set
 * [POS]: Git security policy sibling consumed by managed worktrees and regression tests; process execution remains solely in git-runner
 */

import { runGit } from "./git-runner";

export type GitConfigEntry = Readonly<{
  origin: string;
  key: string;
  value: string;
}>;

/** `--show-origin -z` records have the shape `origin\0key\nvalue\0`. */
export async function listGitConfig(workspace: string) {
  const raw = await runGit(workspace, ["config", "--list", "--show-origin", "-z"]);
  const entries: GitConfigEntry[] = [];
  const tokens = raw.split("\0");
  for (let index = 0; index + 1 < tokens.length; index += 2) {
    const origin = tokens[index]!;
    const record = tokens[index + 1]!;
    const separator = record.indexOf("\n");
    entries.push(separator < 0
      ? { origin, key: record, value: "" }
      : { origin, key: record.slice(0, separator), value: record.slice(separator + 1) });
  }
  return entries;
}

export type GitConfigBlocker = Readonly<{
  code: string;
  key: string;
  origin: string;
  message: string;
}>;

const BOOLEAN_FALSE = new Set(["", "false", "0", "no", "off"]);
const BOOLEAN_TRUE = new Set(["true", "1", "yes", "on"]);

/**
 * The v1 executable-config gate blocks filter drivers, external fsmonitor hooks,
 * and alternateRefsCommand. All other executable keys are overridden by the
 * fixed runner config or unreachable from the offline command set.
 */
export function auditExecutableGitConfig(
  entries: readonly GitConfigEntry[]
): GitConfigBlocker[] {
  const blockers: GitConfigBlocker[] = [];
  for (const entry of entries) {
    const key = entry.key.toLowerCase();
    const filter = /^filter\.(.+)\.(clean|smudge|process|required)$/.exec(key);
    if (filter) {
      blockers.push({
        code: "GIT_CONFIG_FILTER_DRIVER",
        key: entry.key,
        origin: entry.origin,
        message: `仓库有效配置声明了 filter 驱动 ${filter[1]}（${entry.key}，来自 ${entry.origin}）；v1 不在自动化里执行仓库配置的外部程序。请为该仓库停用它后重试。`,
      });
      continue;
    }
    if (key === "core.fsmonitor") {
      const value = entry.value.trim().toLowerCase();
      if (!BOOLEAN_FALSE.has(value) && !BOOLEAN_TRUE.has(value)) {
        blockers.push({
          code: "GIT_CONFIG_EXTERNAL_FSMONITOR",
          key: entry.key,
          origin: entry.origin,
          message: `仓库配置了外部 fsmonitor 钩子（${entry.value}，来自 ${entry.origin}）；v1 不执行仓库配置的外部程序。`,
        });
      }
      continue;
    }
    if (key === "core.alternaterefscommand") {
      blockers.push({
        code: "GIT_CONFIG_ALTERNATE_REFS_COMMAND",
        key: entry.key,
        origin: entry.origin,
        message: `仓库配置了 core.alternateRefsCommand（来自 ${entry.origin}）；v1 不执行仓库配置的外部程序。`,
      });
    }
  }
  return blockers;
}
