/**
 * [INPUT]: Depends on the runtime registry's current/resolve snapshots, the Skill root scanner and the discovery digest cache.
 * [OUTPUT]: Provides installedSkillAgents and createRootScanner, the two pure helpers a candidate refresh is built from.
 * [POS]: skills-management/orchestration discovery leaf; the service decides when to refresh, these decide whom to ask and how often a root is walked.
 */

import type { ManagedSkillAgent } from "../../../../shared/unified-skills-ipc";
import type { BackendRuntimeRegistry } from "../../backends/runtime-registry";
import type { scanAgentSkillsRoot, SkillFolderInspection } from "../package";
import type { SkillDigestCache } from "./digest-cache";
import { AGENTS } from "./discovery-state";

type RuntimeFacts = Pick<BackendRuntimeRegistry, "current" | "resolve">;

/** Without a registry every Agent counts as installed, which is what fixtures rely on. */
export async function installedSkillAgents(registry: RuntimeFacts | undefined) {
  if (!registry) return new Set<ManagedSkillAgent>(AGENTS);
  const agents = await Promise.all(
    AGENTS.map(async (agent) => {
      const snapshot =
        registry.current(agent) ??
        (await registry.resolve(agent).catch(() => null));
      return snapshot?.runtimeStatus === "installed" ? agent : null;
    })
  );
  return new Set(
    agents.filter((agent): agent is ManagedSkillAgent => Boolean(agent))
  );
}

/* `~/.agents/skills` belongs to every Agent, so three of the four targets name the
   same root. Walking it once per target hashed the same bytes three times. */
export function createRootScanner(
  scanner: typeof scanAgentSkillsRoot,
  digestCache: SkillDigestCache
) {
  const scans = new Map<string, Promise<readonly SkillFolderInspection[]>>();
  return (root: string) => {
    let pending = scans.get(root);
    if (!pending) {
      pending = (async () => scanner(root, { digestCache }))();
      scans.set(root, pending);
    }
    return pending;
  };
}
