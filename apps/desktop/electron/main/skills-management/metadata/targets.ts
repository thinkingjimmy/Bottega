/**
 * [INPUT]: Depends on Node path, the provider catalog's skills roots and the descriptor path resolver, and explicit platform home/env; Not reading the renderer input
 * [OUTPUT]: Provides each provider's skills root (from its descriptor, resolved against the launch HOME) for the read-only Agent import-candidate directories, and the shared candidate root
 * [POS]: apps/desktop/electron/main/skills-management/metadata; Sole path source for read-only Agent-home discovery; no returned path is a delivery or projection target
 */

import { join } from "node:path";
import { providerCatalog } from "../../providers/host/catalog";
import { resolveHomePath, resolveLaunchHome } from "../../../../shared/providers/home-path";
import type { ManagedSkillAgent } from "../../../../shared/ipc/agent/unified-skills-ipc";

/* 只剩发现所需的两个事实：谁家、在哪。投影时代的 id/label/deprecated
   已无任何读者，随投影一并退役。 */
export type ManagedSkillTarget = Readonly<{
  agent: ManagedSkillAgent;
  path: string;
}>;

/** Each provider's own skills root, as its descriptor declares it, resolved against the HOME its CLI runs with. */
export function resolveManagedSkillTargets(
  platformHome: string,
  env: NodeJS.ProcessEnv
): readonly ManagedSkillTarget[] {
  const userHome = resolveLaunchHome(env, platformHome);
  return providerCatalog().catalog().entries().flatMap((entry) => entry.descriptor.skills
    ? [{ agent: entry.id as ManagedSkillAgent, path: resolveHomePath(entry.descriptor.skills.root, env, userHome) }]
    : []);
}

export function resolveSharedSkillsRoot(userHome: string) {
  return join(userHome, ".agents", "skills");
}
