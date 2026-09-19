/**
 * [INPUT]: Depends on the runtime-candidate source inventory, Extension Registry visible inventory and the four backend capability proofs
 * [OUTPUT]: Provides runtimeSkillCandidates, the per-turn EffectiveSkillCandidate list with SKILL.md paths, present content only, and per-backend Extension eligibility
 * [POS]: skills-management/orchestration turn projector; the service decides when a turn needs candidates, this decides what a turn may see
 */

import { join } from "node:path";
import type { AgentBackendId } from "../../../../shared/agent-ipc";
import type { TurnProjectContext } from "../../../../shared/product-resource-scope";
import { buildExtensionCapabilitySnapshot } from "../../extensions/capability-snapshot";
import {
  backendExtensionProbe,
  EXTENSION_PRODUCT_POLICY,
} from "../../extensions/product-policy";
import type { ExtensionRegistryStore } from "../../extensions/registry-store";
import type { EffectiveSkillCandidate } from "../effective-snapshot";
import type { LibrarySource } from "./library-sources";

export function runtimeSkillCandidates(input: Readonly<{
  registry: ExtensionRegistryStore;
  projectContext: TurnProjectContext;
  sources: readonly LibrarySource[];
}>): EffectiveSkillCandidate[] {
  const eligibleBackends = backendEligibility(input.registry, input.projectContext);
  /* A head can arrive long before its bytes. Offering such a Skill to an Agent
     produces a use_skill that cannot possibly succeed; Settings says why. */
  return input.sources
    .filter((source) => source.contentState === "ready")
    .map((source) => {
      /* One convention everywhere: the candidate names the SKILL.md file, and
         consumers take its dirname for the generation directory. */
      const path = join(source.sourcePath, "SKILL.md");
      const shared = {
        name: source.name,
        ownerRef: source.ref,
        digest: source.digest,
        enabled: source.enabled,
        ...(source.requires ? { requires: source.requires } : {}),
        metadata: {
          description: source.description,
          displayName: source.displayName,
        },
        path,
      };
      if (source.local) {
        const generation = source.local.generations.find(
          (item) => item.generationId === source.local!.activeGenerationId
        )!;
        return {
          ...shared,
          sourceKind: "library",
          generationRef: {
            kind: "library",
            libraryId: source.local.libraryId,
            generationId: generation.generationId,
          },
        } satisfies EffectiveSkillCandidate;
      }
      return {
        ...shared,
        sourceKind: "extension",
        generationRef: {
          kind: "extension",
          componentInstanceIdentity: source.source.componentInstanceIdentity!,
          package: source.packageGenerationRef!,
        },
        extensionSelection: {
          installIdentity: source.source.installIdentity!,
          declaredComponentIdentity: source.declaredComponentIdentity!,
          ownerScope: source.ownerScope!,
          eligibleBackends:
            eligibleBackends.get(source.source.componentInstanceIdentity!) ?? [],
        },
      } satisfies EffectiveSkillCandidate;
    });
}

function backendEligibility(
  registry: ExtensionRegistryStore,
  projectContext: TurnProjectContext
) {
  const inventory = registry.visibleInventory(projectContext);
  const eligible = new Map<string, AgentBackendId[]>();
  for (const backend of ["codex", "claude", "kimi", "opencode"] as const) {
    const capability = buildExtensionCapabilitySnapshot({
      inventory,
      probe: backendExtensionProbe(backend, `${backend}:skills-current`, "current"),
      policy: EXTENSION_PRODUCT_POLICY,
      selection: "effective",
    });
    for (const entry of capability.entries) {
      const values = eligible.get(entry.componentInstanceIdentity) ?? [];
      values.push(backend);
      eligible.set(entry.componentInstanceIdentity, values);
    }
  }
  return eligible;
}
