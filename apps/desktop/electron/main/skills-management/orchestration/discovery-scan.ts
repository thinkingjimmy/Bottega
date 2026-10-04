/**
 * [INPUT]: Depends on the runtime registry's current/resolve snapshots, the Skill root scanner and the discovery digest cache.
 * [OUTPUT]: Provides installedSkillAgents (installed Agents, and which of them were only located) and createRootScanner, the two pure helpers a candidate refresh is built from.
 * [POS]: skills-management/orchestration discovery leaf; the service decides when to refresh, these decide whom to ask and how often a root is walked.
 */

import type { ManagedSkillAgent } from "../../../../shared/ipc/agent/unified-skills-ipc";
import type { BackendRuntimeRegistry } from "../../backends/runtime/runtime-registry";
import type { scanAgentSkillsRoot, SkillFolderInspection } from "../package";
import type { SkillDigestCache } from "./digest-cache";
import { AGENTS } from "./discovery-state";

type RuntimeFacts = Pick<BackendRuntimeRegistry, "current" | "resolve">;

/** Without a registry every Agent counts as installed, which is what fixtures rely on. Without `discover`, an Agent
    the registry has not resolved yet counts when `locate` finds its executable — a path search, never `--version`:
    a launch starts no CLI just to look for Skills (OPT-20). Those come back `unverified` so their first real snapshot
    can rescan. */
export async function installedSkillAgents(
  registry: RuntimeFacts | undefined,
  options: { agents?: readonly ManagedSkillAgent[]; discover: boolean; locate?: (agent: ManagedSkillAgent) => Promise<boolean> }
) {
  const candidates = options.agents ?? AGENTS;
  const unverified = new Set<ManagedSkillAgent>();
  if (!registry) return { installed: new Set<ManagedSkillAgent>(candidates), unverified };
  const agents = await Promise.all(
    candidates.map(async (agent) => {
      const known = registry.current(agent);
      if (!known && !options.discover) {
        unverified.add(agent);
        return (await options.locate?.(agent).catch(() => false)) ? agent : null;
      }
      const snapshot = known ?? (await registry.resolve(agent).catch(() => null));
      return snapshot?.runtimeStatus === "installed" ? agent : null;
    })
  );
  return {
    installed: new Set(agents.filter((agent): agent is ManagedSkillAgent => Boolean(agent))),
    unverified,
  };
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
