/**
 * [INPUT]: Depends on Node path and explicit userHome/env; Not reading the renderer input
 * [OUTPUT]: Provides respect for HOME/USERPROFILE user roots, four projected goal resolvers, read-only shared roots and complete viewpoints
 * [POS]: The only source of truth about the target directory of skills-management; Environmental chain, product-side and product-side meeting policies should not be spread out into UI or saga
 */

import { join, resolve } from "node:path";
import type {
  ManagedSkillAgent,
  ManagedSkillVisibility,
} from "../../../shared/unified-skills-ipc";

export type ManagedSkillTarget = Readonly<{
  id: string;
  agent: ManagedSkillAgent;
  path: string;
  label: string;
  deprecated: boolean;
  visibleTo: readonly ManagedSkillVisibility[];
}>;

const product = (agent: ManagedSkillAgent): ManagedSkillVisibility => ({
  agent,
  surface: "product-and-terminal",
});
const terminal = (agent: ManagedSkillAgent): ManagedSkillVisibility => ({
  agent,
  surface: "terminal-only",
});

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
    {
      id: "codex-home",
      agent: "codex",
      path: join(codexRoot, "skills"),
      label: "Codex home",
      deprecated: true,
      visibleTo: [product("codex")],
    },
    {
      id: "claude-home",
      agent: "claude",
      path: join(userHome, ".claude", "skills"),
      label: "Claude home",
      deprecated: false,
      visibleTo: [product("claude"), terminal("opencode")],
    },
    {
      id: "kimi-home",
      agent: "kimi",
      path: join(kimiRoot, "skills"),
      label: "Kimi home",
      deprecated: false,
      visibleTo: [product("kimi")],
    },
    {
      id: "opencode-home",
      agent: "opencode",
      path: join(xdgRoot, "opencode", "skills"),
      label: "OpenCode home",
      deprecated: false,
      visibleTo: [terminal("opencode")],
    },
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

export function targetForAgent(
  targets: readonly ManagedSkillTarget[],
  agent: ManagedSkillAgent
) {
  const target = targets.find((item) => item.agent === agent);
  if (!target) throw new Error(`未知 Skill 投影目标：${agent}`);
  return target;
}
