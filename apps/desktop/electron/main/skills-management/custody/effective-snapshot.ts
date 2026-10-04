/**
 * [INPUT]: Depends on admitted source candidates, final allowed-tools eligibility, plan mode, and four backend capability proofs
 * [OUTPUT]: Provides EffectiveSkillSnapshot plus durable prepared-candidate receipts with frozen owner/generation/digest identity, channels, negative shadowing, and source errors
 * [POS]: apps/desktop/electron/main/skills-management/custody; Per-turn Skills truth; catalog, prompt inventory, picker, and use_skill consume this module instead of composing their own worlds, and it is the single gate that admits only SKILL.md-file candidate paths
 */

import { basename } from "node:path";
import type { ProviderId } from "@bottega/contracts/model/provider";
import type { PreparedSkillSelectionReceipt } from "../../../../shared/ipc/agent/agent-ipc";
import type { ExtensionPackageGenerationRef } from "../../../../shared/ipc/settings/extensions-ipc";
import type { ProductResourceScope } from "../../../../shared/product/product-resource-scope";
import { skillRequirementSatisfied } from "../metadata/skill-requirements";
import {
  admitSkillSlug,
  type SkillSlug,
  type SkillSlugAdmission,
} from "../metadata/skill-slug";

const SKILL_SOURCE_PRIORITY = {
  library: 4,
  extension: 3,
  project: 2,
  system: 1,
} as const;

export type EffectiveSkillSourceKind = keyof typeof SKILL_SOURCE_PRIORITY;
export type EffectiveSkillChannel = "catalog" | "picker" | "use-skill";

export type SkillGenerationRef =
  | Readonly<{ kind: "library"; libraryId: string; generationId: string }>
  | Readonly<{
      kind: "extension";
      componentInstanceIdentity: string;
      package: ExtensionPackageGenerationRef;
    }>
  | Readonly<{ kind: "filesystem"; path: string }>;

export type EffectiveSkillMetadata = Readonly<{
  description: string;
  displayName?: string;
}>;

export type EffectiveSkillCandidate = Readonly<{
  name: string;
  sourceKind: EffectiveSkillSourceKind;
  generationRef: SkillGenerationRef;
  digest: `sha256:${string}`;
  enabled: boolean;
  requires?: string;
  metadata: EffectiveSkillMetadata;
  /* Always the SKILL.md file, never its folder: every consumer derives the
     generation directory with dirname(). Library, Extension, project and system
     producers normalize before handing a candidate over. */
  path: string;
  ownerRef: string;
  extensionSelection?: Readonly<{
    installIdentity: string;
    declaredComponentIdentity: string;
    ownerScope: ProductResourceScope;
    eligibleBackends: readonly ProviderId[];
  }>;
}>;

export type BackendSkillCapabilityFacts = Readonly<{
  backend: ProviderId;
  useSkillRegistered: boolean;
  exactIssued: boolean;
  autoApproved: boolean;
  runtimeRootReadable: boolean;
}>;

export type EffectiveSkillEntry = Readonly<{
  slug: SkillSlug;
  sourceKind: EffectiveSkillSourceKind;
  ownerRef: string;
  generationRef: SkillGenerationRef;
  digest: `sha256:${string}`;
  path: string;
  enabled: boolean;
  available: boolean;
  channels: readonly EffectiveSkillChannel[];
  requires?: string;
  metadata: EffectiveSkillMetadata;
  extensionSelection?: EffectiveSkillCandidate["extensionSelection"];
}>;

export type EffectiveSkillPathRejection = Readonly<{
  ok: false;
  code: "invalid-path";
  value: string;
  reason: "not-skill-md";
}>;

export type EffectiveSkillSourceError = Readonly<{
  sourceKind: EffectiveSkillSourceKind;
  ownerRef: string;
  admission: Exclude<SkillSlugAdmission, { ok: true }> | EffectiveSkillPathRejection;
}>;

export type EffectiveSkillSnapshot = Readonly<{
  backend: ProviderId;
  planMode: boolean;
  capable: boolean;
  entries: readonly EffectiveSkillEntry[];
  sourceErrors: readonly EffectiveSkillSourceError[];
}>;

export function preparedSkillCandidates(
  snapshot: EffectiveSkillSnapshot
): PreparedSkillSelectionReceipt["candidates"] {
  return snapshot.entries.map((entry) => ({
    name: entry.slug,
    sourceKind: entry.sourceKind,
    generationRef: structuredClone(entry.generationRef),
    digest: entry.digest,
    enabled: entry.enabled,
    ...(entry.requires ? { requires: entry.requires } : {}),
    metadata: { ...entry.metadata },
    path: entry.path,
    ownerRef: entry.ownerRef,
  }));
}

function backendIsSkillCapable(facts: BackendSkillCapabilityFacts) {
  return (
    facts.useSkillRegistered &&
    facts.exactIssued &&
    facts.autoApproved &&
    facts.runtimeRootReadable
  );
}

export function composeEffectiveSkillSnapshot(input: Readonly<{
  backend: ProviderId;
  planMode: boolean;
  allowedTools: readonly string[];
  capability: BackendSkillCapabilityFacts;
  candidates: readonly EffectiveSkillCandidate[];
}>): EffectiveSkillSnapshot {
  const candidates = selectExtensionOwners(input.candidates, input.backend);
  const admitted: Array<EffectiveSkillCandidate & { slug: SkillSlug }> = [];
  const sourceErrors: EffectiveSkillSourceError[] = [];
  for (const candidate of candidates) {
    if (basename(candidate.path) !== "SKILL.md") {
      sourceErrors.push({
        sourceKind: candidate.sourceKind,
        ownerRef: candidate.ownerRef,
        admission: {
          ok: false,
          code: "invalid-path",
          value: candidate.path,
          reason: "not-skill-md",
        },
      });
      continue;
    }
    const admission = admitSkillSlug(candidate.name);
    if (!admission.ok) {
      sourceErrors.push({
        sourceKind: candidate.sourceKind,
        ownerRef: candidate.ownerRef,
        admission,
      });
      continue;
    }
    admitted.push({ ...candidate, slug: admission.slug });
  }

  const ordered = admitted.sort(compareCandidate);
  const owners = new Map<SkillSlug, (typeof ordered)[number]>();
  for (const candidate of ordered) {
    if (!owners.has(candidate.slug)) owners.set(candidate.slug, candidate);
  }

  const capable = backendIsSkillCapable(input.capability);
  const entries = [...owners.values()]
    .map((owner): EffectiveSkillEntry => {
      const available =
        owner.enabled &&
        skillRequirementSatisfied(owner.requires, input.allowedTools);
      return Object.freeze({
        slug: owner.slug,
        sourceKind: owner.sourceKind,
        ownerRef: owner.ownerRef,
        generationRef: structuredClone(owner.generationRef),
        digest: owner.digest,
        path: owner.path,
        enabled: owner.enabled,
        available,
        channels: Object.freeze(
          available
            ? capable
              ? (["catalog", "picker", "use-skill"] as const)
              : (["catalog", "picker"] as const)
            : []
        ),
        ...(owner.requires ? { requires: owner.requires } : {}),
        metadata: Object.freeze({ ...owner.metadata }),
        ...(owner.extensionSelection
          ? {
              extensionSelection: Object.freeze({
                ...owner.extensionSelection,
                ownerScope: structuredClone(
                  owner.extensionSelection.ownerScope
                ),
                eligibleBackends: Object.freeze([
                  ...owner.extensionSelection.eligibleBackends,
                ]),
              }),
            }
          : {}),
      });
    })
    .sort(compareEntry);

  return Object.freeze({
    backend: input.backend,
    planMode: input.planMode,
    capable,
    entries: Object.freeze(entries),
    sourceErrors: Object.freeze(sourceErrors),
  });
}

function selectExtensionOwners(
  candidates: readonly EffectiveSkillCandidate[],
  backend: ProviderId
) {
  const fixed = candidates.filter(
    (candidate) => candidate.sourceKind !== "extension" || !candidate.extensionSelection
  );
  const selectable = candidates.filter(
    (candidate) =>
      candidate.sourceKind === "extension" &&
      candidate.extensionSelection?.eligibleBackends.includes(backend)
  );
  const grouped = new Map<string, EffectiveSkillCandidate[]>();
  for (const candidate of selectable) {
    const identity = candidate.extensionSelection!.declaredComponentIdentity;
    const values = grouped.get(identity) ?? [];
    values.push(candidate);
    grouped.set(identity, values);
  }
  const selected = [...grouped.values()].flatMap((values) => {
    const project = values.filter(
      (candidate) => candidate.extensionSelection!.ownerScope.kind === "project"
    );
    const global = values.filter(
      (candidate) => candidate.extensionSelection!.ownerScope.kind === "global"
    );
    if (project.length === 1) return project;
    if (project.length > 1 || global.length !== 1) return [];
    return global;
  });
  return [...fixed, ...selected];
}

function compareCandidate(
  left: EffectiveSkillCandidate & { slug: SkillSlug },
  right: EffectiveSkillCandidate & { slug: SkillSlug }
) {
  return (
    left.slug.localeCompare(right.slug) ||
    SKILL_SOURCE_PRIORITY[right.sourceKind] -
      SKILL_SOURCE_PRIORITY[left.sourceKind] ||
    left.ownerRef.localeCompare(right.ownerRef)
  );
}

function compareEntry(left: EffectiveSkillEntry, right: EffectiveSkillEntry) {
  return (
    SKILL_SOURCE_PRIORITY[right.sourceKind] -
      SKILL_SOURCE_PRIORITY[left.sourceKind] ||
    left.slug.localeCompare(right.slug)
  );
}
