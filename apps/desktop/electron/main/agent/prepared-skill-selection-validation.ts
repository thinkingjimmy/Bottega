/**
 * [INPUT]: Depends on the shared Agent backend, Project context, extension-generation, prepared Skill receipt contracts, and the canonical Skill slug/count admission rules
 * [OUTPUT]: Provides strict reconstruction of a bounded main-owned PreparedSkillSelectionReceipt with closed nested object shapes, canonical digests, unique admitted names, and source/generation consistency
 * [POS]: Internal Agent-start trust-boundary helper; public IPC never delegates renderer input to this parser
 */

import { z } from "zod";
import {
  AGENT_BACKEND_ORDER,
  type PreparedSkillSelectionReceipt,
} from "../../../shared/agent-ipc";
import { assertTurnProjectContext } from "../../../shared/product-resource-scope";
import { SKILL_COUNT_LIMIT } from "../skills-catalog-scan";
import { admitSkillSlug } from "../skills-management/skill-slug";

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const nonEmpty = z.string().refine((value) => value.trim().length > 0);
const packageGeneration = z.object({
  packageGenerationId: nonEmpty,
  recordDigest: digest,
}).strict();
const generationRef = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("library"),
    libraryId: nonEmpty,
    generationId: nonEmpty,
  }).strict(),
  z.object({
    kind: z.literal("extension"),
    componentInstanceIdentity: nonEmpty,
    package: packageGeneration,
  }).strict(),
  z.object({ kind: z.literal("filesystem"), path: nonEmpty }).strict(),
]);
const candidate = z.object({
  name: nonEmpty.refine((value) => admitSkillSlug(value).ok),
  sourceKind: z.enum(["library", "extension", "project", "system"]),
  generationRef,
  digest,
  enabled: z.boolean(),
  requires: nonEmpty.optional(),
  metadata: z.object({
    description: nonEmpty,
    displayName: nonEmpty.optional(),
  }).strict(),
  path: nonEmpty,
  ownerRef: nonEmpty,
}).strict().superRefine((value, context) => {
  const expected = value.sourceKind === "library"
    ? "library"
    : value.sourceKind === "extension"
      ? "extension"
      : "filesystem";
  if (value.generationRef.kind !== expected) {
    context.addIssue({
      code: "custom",
      path: ["generationRef", "kind"],
      message: "sourceKind and generationRef.kind do not match",
    });
  }
});
const receipt = z.object({
  refOwnerId: nonEmpty,
  projectContext: z.object({
    projectId: z.string().nullable(),
    projectLifecycleRevision: z.number().nullable(),
  }).strict(),
  visibleInventoryVersion: nonEmpty,
  backend: z.enum(AGENT_BACKEND_ORDER),
  planMode: z.boolean(),
  candidates: z.array(candidate).max(SKILL_COUNT_LIMIT),
}).strict().superRefine((value, context) => {
  const names = new Set<string>();
  for (let index = 0; index < value.candidates.length; index += 1) {
    const name = value.candidates[index]!.name;
    if (names.has(name)) {
      context.addIssue({
        code: "custom",
        path: ["candidates", index, "name"],
        message: "candidate names must be unique",
      });
    }
    names.add(name);
  }
});

export function parsePreparedSkillSelection(
  value: unknown
): PreparedSkillSelectionReceipt {
  const parsed = receipt.parse(value);
  return {
    ...parsed,
    projectContext: assertTurnProjectContext(parsed.projectContext),
  } as PreparedSkillSelectionReceipt;
}
