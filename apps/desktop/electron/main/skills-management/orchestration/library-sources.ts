/**
 * [INPUT]: Depends on the private library, Extension Registry active generations, content-addressed package roots, and strict package inspection
 * [OUTPUT]: Provides separate exact-owner management and backend-neutral runtime-candidate Skill sources with scope/generation identity, per-entry content presence, and a digest-keyed Extension package cache
 * [POS]: Library-first source projector; Settings never reuses runtime visibility and runtime selection never hides management rows
 */

import { lstat } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionPackageGenerationRef } from "../../../../shared/extensions-ipc";
import type { TurnProjectContext } from "../../../../shared/product-resource-scope";
import type { ProductResourceScope } from "../../../../shared/product-resource-scope";
import type {
  ManagedSkillContentState,
  ManagedSkillLibraryItem,
  ManagedSkillSourceKind,
} from "../../../../shared/unified-skills-ipc";
import { extensionPackageRoot } from "../../extensions/skill-candidates";
import type { ExtensionRegistryStore } from "../../extensions/registry-store";
import type {
  ManagedSkillsLibraryEntry,
  ManagedSkillsLibraryStore,
} from "../library-store";
import { scanAgentSkillsRoot, type SkillFolderInspection } from "../package";

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
  contentState: ManagedSkillContentState;
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
  const local: LibrarySource[] = [];
  for (const entry of input.library.snapshot().entries) {
    if (entry.tombstoneAt !== null) continue;
    const generation = entry.generations.find(
      (item) => item.generationId === entry.activeGenerationId
    );
    if (!generation) continue;
    const kind = entry.provenance.kind satisfies Exclude<
      ManagedSkillSourceKind,
      "extension"
    >;
    const sourcePath = input.library.packagePath(entry);
    local.push({
      libraryId: entry.libraryId,
      ref: `library:${entry.libraryId}`,
      name: entry.name,
      displayName: entry.displayName,
      description: entry.description,
      ...(entry.requires ? { requires: entry.requires } : {}),
      digest: generation.digest as `sha256:${string}`,
      sourcePath,
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
      contentState: await contentStateOf(sourcePath, generation.importedAt),
      local: entry,
      packageGenerationRef: null,
    });
  }

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
        enabled: input.registry.lifecycle.isComponentEnabled(
          component.componentInstanceIdentity
        ),
        contentState: "ready",
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

/* A head record published by another device arrives before its bytes do: the
   entry is real, its folder is not. Saying so is the difference between a row
   that explains itself and a Skill that fails the moment an Agent reaches for
   it — importedAt 0 is the metadata-only placeholder the downlink writes. */
async function contentStateOf(
  sourcePath: string,
  importedAt: number
): Promise<ManagedSkillContentState> {
  const present = await lstat(join(sourcePath, "SKILL.md")).then(
    (stat) => stat.isFile(),
    () => false
  );
  if (present) return "ready";
  return importedAt === 0 ? "downloading" : "missing";
}

/* Extension package roots are content-addressed and immutable, so one hash of
   a given digest answers every turn that follows. Without this the prompt path
   re-read and re-SHA-256'd every installed package on every single turn.
   Insertion order is the eviction order: upgrades retire old digests. */
const PACKAGE_CACHE_LIMIT = 32;
const packageSkillCache = new Map<
  string,
  Promise<ReadonlyMap<string, SkillFolderInspection>>
>();

function packageSkills(userData: string, contentDigest: string) {
  let pending = packageSkillCache.get(contentDigest);
  if (!pending) {
    pending = (async () => {
      const root = extensionPackageRoot(userData, contentDigest);
      const inspections = await scanAgentSkillsRoot(join(root, "skills"), {
        hashAll: true,
      });
      return new Map(
        inspections
          .filter((item) => item.importable)
          .map((item) => [item.skill.name, item] as const)
      );
    })().catch((cause) => {
      packageSkillCache.delete(contentDigest);
      throw cause;
    });
    packageSkillCache.set(contentDigest, pending);
    while (packageSkillCache.size > PACKAGE_CACHE_LIMIT) {
      const oldest = packageSkillCache.keys().next();
      if (oldest.done || oldest.value === contentDigest) break;
      packageSkillCache.delete(oldest.value);
    }
  }
  return pending;
}
