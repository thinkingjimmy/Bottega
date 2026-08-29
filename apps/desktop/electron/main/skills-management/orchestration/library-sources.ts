/**
 * [INPUT]: Depends on the private library, Extension Registry active generations, content-addressed package roots, and strict package inspection
 * [OUTPUT]: Provides separate exact-owner management and backend-neutral runtime-candidate Skill sources with scope/generation identity
 * [POS]: Library-first source projector; Settings never reuses runtime visibility and runtime selection never hides management rows
 */

import { join } from "node:path";
import type { ExtensionPackageGenerationRef } from "../../../../shared/extensions-ipc";
import type { TurnProjectContext } from "../../../../shared/product-resource-scope";
import type { ProductResourceScope } from "../../../../shared/product-resource-scope";
import type {
  ManagedSkillLibraryItem,
  ManagedSkillSourceKind,
} from "../../../../shared/unified-skills-ipc";
import { extensionPackageRoot } from "../../extensions/skill-candidates";
import type { ExtensionRegistryStore } from "../../extensions/registry-store";
import type {
  ManagedSkillsLibraryEntry,
  ManagedSkillsLibraryStore,
} from "../library-store";
import { scanAgentSkillsRoot } from "../package";

export type LibrarySource = Readonly<{
  libraryId: string;
  ref: string;
  name: string;
  displayName: string;
  description: string;
  requires?: string;
  digest: `sha256:${string}`;
  sourcePath: string;
  source: ManagedSkillLibraryItem["source"];
  enabled: boolean;
  local: ManagedSkillsLibraryEntry | null;
  packageGenerationRef: ExtensionPackageGenerationRef | null;
  declaredComponentIdentity?: string;
  ownerScope?: ProductResourceScope;
}>;

export async function resolveLibrarySources(input: Readonly<{
  userData: string;
  library: ManagedSkillsLibraryStore;
  registry: ExtensionRegistryStore;
  projectContext: TurnProjectContext;
  projection: "management" | "runtime-candidates";
}>): Promise<LibrarySource[]> {
  const local = input.library.snapshot().entries.flatMap((entry) => {
    if (entry.tombstoneAt !== null) return [];
    const generation = entry.generations.find(
      (item) => item.generationId === entry.activeGenerationId
    );
    if (!generation) return [];
    const kind = entry.provenance.kind satisfies Exclude<
      ManagedSkillSourceKind,
      "extension"
    >;
    return [
      {
        libraryId: entry.libraryId,
        ref: `library:${entry.libraryId}`,
        name: entry.name,
        displayName: entry.displayName,
        description: entry.description,
        ...(entry.requires ? { requires: entry.requires } : {}),
        digest: generation.digest as `sha256:${string}`,
        sourcePath: input.library.packagePath(entry),
        source: {
          kind,
          label:
            entry.provenance.kind === "adopted"
              ? `${entry.provenance.agent} import`
              : "Local folder",
          generation: entry.generations.length,
          active: true,
        },
        enabled: entry.enabled,
        local: entry,
        packageGenerationRef: null,
      } satisfies LibrarySource,
    ];
  });

  const scope = input.projectContext.projectId
    ? { kind: "project" as const, projectId: input.projectContext.projectId }
    : { kind: "global" as const };
  const inventory = input.projection === "management"
    ? input.registry.ownedInventory(
        scope,
        input.projectContext.projectLifecycleRevision
      )
    : input.registry.visibleInventory(input.projectContext);
  const extensions: LibrarySource[] = [];
  for (const owner of inventory.packages) {
    if (!owner.activeGenerationRef) continue;
    const generation = owner.generations.find(
      (item) =>
        item.packageGenerationId ===
        owner.activeGenerationRef!.packageGenerationId
    );
    if (!generation) continue;
    const skills = await packageSkills(input.userData, generation.contentDigest);
    for (const component of inventory.components) {
      if (
        component.kind !== "skill" ||
        component.packageGenerationRef.packageGenerationId !==
          generation.packageGenerationId
      ) {
        continue;
      }
      const name = component.componentId.replace(/^skill:/, "");
      const exact = skills.get(name);
      if (!exact?.importable) continue;
      const skill = exact.skill;
      extensions.push({
        libraryId: `extension:${component.componentInstanceIdentity}`,
        ref: `extension:${component.componentInstanceIdentity}`,
        name: skill.name,
        displayName: skill.displayName,
        description: skill.description,
        ...(skill.requires ? { requires: skill.requires } : {}),
        digest: skill.digest!,
        sourcePath: skill.canonicalPath,
        source: {
          kind: "extension",
          label: owner.source.normalizedUrl,
          generation: owner.generations.length,
          installIdentity: owner.installIdentity,
          componentInstanceIdentity: component.componentInstanceIdentity,
          active: owner.administrativeState === "active",
        },
        enabled: input.registry.isComponentEnabled(
          component.componentInstanceIdentity
        ),
        local: null,
        packageGenerationRef: component.packageGenerationRef,
        declaredComponentIdentity: component.declaredComponentIdentity,
        ownerScope: owner.scope,
      });
    }
  }
  return [...local, ...extensions].sort(
    (left, right) =>
      left.displayName.localeCompare(right.displayName) ||
      left.ref.localeCompare(right.ref)
  );
}

async function packageSkills(userData: string, contentDigest: string) {
  const root = extensionPackageRoot(userData, contentDigest);
  const inspections = await scanAgentSkillsRoot(join(root, "skills"), {
    hashAll: true,
  });
  return new Map(
    inspections
      .filter((item) => item.importable)
      .map((item) => [item.skill.name, item] as const)
  );
}
