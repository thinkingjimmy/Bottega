/**
 * [INPUT]: Depends on immutable CatalogSkill/EffectiveSkillCandidate contracts, guarded filesystem primitives, and product-failure codes
 * [OUTPUT]: Provides candidate/catalog projection, source scope mapping, stable Skill reads, and runtime failure normalization
 * [POS]: Pure projection and filesystem-read boundary for SkillsCatalog; cache, token, IPC, and selection state remain in skills-catalog.ts
 */

import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import type { SkillInfo } from "../../shared/skills-ipc";
import {
  ProductFailureError,
  skillsRuntimeFailure,
} from "../../shared/product-failure";
import type { CatalogSkill } from "./skills-catalog";
import { SKILL_FILE_LIMIT } from "./skills-catalog-scan";
import type { EffectiveSkillCandidate } from "./skills-management/effective-snapshot";

export function catalogSkillOf(candidate: EffectiveSkillCandidate): CatalogSkill {
  return {
    ref: candidate.ownerRef,
    name: candidate.name,
    description: candidate.metadata.description,
    scope: scopeOf(candidate.sourceKind),
    ...(candidate.metadata.displayName
      ? { displayName: candidate.metadata.displayName }
      : {}),
    ...(candidate.requires ? { requires: candidate.requires } : {}),
    path: candidate.path,
    sourceKind: candidate.sourceKind,
    generationRef: candidate.generationRef,
    digest: candidate.digest,
    enabled: candidate.enabled,
    ownerRef: candidate.ownerRef,
    ...(candidate.extensionSelection
      ? {
          ownerScope: structuredClone(candidate.extensionSelection.ownerScope),
          extensionSelection: structuredClone(candidate.extensionSelection),
        }
      : { ownerScope: { kind: "global" as const } }),
  };
}

export function toEffectiveCandidate(skill: CatalogSkill): EffectiveSkillCandidate {
  return {
    name: skill.name,
    sourceKind: skill.sourceKind,
    generationRef: skill.generationRef,
    digest: skill.digest,
    enabled: skill.enabled !== false,
    ...(skill.requires ? { requires: skill.requires } : {}),
    metadata: {
      description: skill.description,
      ...(skill.displayName ? { displayName: skill.displayName } : {}),
    },
    path: skill.path,
    ownerRef: skill.ownerRef,
    ...(skill.extensionSelection
      ? { extensionSelection: structuredClone(skill.extensionSelection) }
      : {}),
  };
}

export function scopeOf(
  source: EffectiveSkillCandidate["sourceKind"]
): SkillInfo["scope"] {
  if (source === "library") return "user";
  if (source === "project") return "repo";
  return source;
}

/** Revalidates dev/ino/size/mtime while reading through O_NOFOLLOW. */
export async function readStableSkill(path: string) {
  let file;
  try {
    if ((await realpath(path)) !== path) throw runtimeError("changed-during-read");
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await file.stat();
    if (!before.isFile()) throw runtimeError("unavailable");
    if (before.size > SKILL_FILE_LIMIT) {
      throw runtimeError("file-too-large", {
        version: 1,
        kind: "limit",
        limit: SKILL_FILE_LIMIT,
      });
    }
    const content = await file.readFile();
    const after = await file.stat();
    if (
      content.byteLength !== before.size ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    ) {
      throw runtimeError("changed-during-read");
    }
    return content;
  } catch (cause) {
    if (cause instanceof ProductFailureError) throw cause;
    throw runtimeError("unavailable");
  } finally {
    await file?.close();
  }
}

export function runtimeError(
  code: Parameters<typeof skillsRuntimeFailure>[0],
  details: Parameters<typeof skillsRuntimeFailure>[1] = { version: 1, kind: "none" }
) {
  return new ProductFailureError(skillsRuntimeFailure(code, details));
}

export function toRuntimeFailure(cause: unknown) {
  if (cause instanceof ProductFailureError) return cause.failure;
  const status = Number((cause as { status?: unknown } | null)?.status);
  return skillsRuntimeFailure(status === 400 ? "invalid-request" : "unavailable");
}
