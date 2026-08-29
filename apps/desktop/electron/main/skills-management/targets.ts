/**
 * [INPUT]: Depends on Node path and explicit userHome/env; Not reading the renderer input
 * [OUTPUT]: Provides HOME/USERPROFILE-aware roots for the four read-only Agent import-candidate directories and the shared candidate root
 * [POS]: Sole path source for read-only Agent-home discovery; no returned path is a delivery or projection target
 */

import { join, resolve } from "node:path";
import type { ManagedSkillAgent } from "../../../shared/unified-skills-ipc";

/* 只剩发现所需的两个事实：谁家、在哪。投影时代的 id/label/deprecated
   已无任何读者，随投影一并退役。 */
export type ManagedSkillTarget = Readonly<{
  agent: ManagedSkillAgent;
  path: string;
}>;

export function resolveManagedSkillTargets(
  userHome: string,
  env: NodeJS.ProcessEnv
): readonly ManagedSkillTarget[] {
  userHome = resolveManagedSkillUserHome(userHome, env);
  const codexRoot = env.CODEX_HOME
    ? resolve(env.CODEX_HOME)
    : join(userHome, ".codex");
  const kimiRoot = env.KIMI_CODE_HOME
    ? resolve(env.KIMI_CODE_HOME)
    : join(userHome, ".kimi-code");
  const xdgRoot = env.XDG_CONFIG_HOME
    ? resolve(env.XDG_CONFIG_HOME)
    : join(userHome, ".config");
  return [
    { agent: "codex", path: join(codexRoot, "skills") },
    { agent: "claude", path: join(userHome, ".claude", "skills") },
    { agent: "kimi", path: join(kimiRoot, "skills") },
    { agent: "opencode", path: join(xdgRoot, "opencode", "skills") },
  ];
}

export function resolveManagedSkillUserHome(
  platformHome: string,
  env: NodeJS.ProcessEnv
) {
  const configured = env.HOME?.trim() || env.USERPROFILE?.trim();
  return configured ? resolve(configured) : platformHome;
}

export function resolveSharedSkillsRoot(userHome: string) {
  return join(userHome, ".agents", "skills");
}
