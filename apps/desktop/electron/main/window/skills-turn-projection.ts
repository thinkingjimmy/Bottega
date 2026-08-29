/**
 * [INPUT]: Depends on post-runtime-CAS AgentContext, canonical Project context, durable Project Tools/Skill receipts, frozen builtin policy, SkillsCatalog, and custody
 * [OUTPUT]: Provides finalizeSkillsTurnProjection, rechecking frozen requirements while preserving exact prepared Skill owners before prompt/tool projection
 * [POS]: Main-window Skills seam; runtime capability may narrow channels but never rebind durable Project policy or Extension owners
 */

import type {
  AgentContext,
  BuiltinTurnToolPolicy,
} from "../agent/bridge-types";
import { createFinalTurnProjection } from "../agent/product-context";
import type { SkillsCatalog } from "../skills-catalog";
import type { SkillsTurnCustodyStore } from "../skills-management/turn-custody";
import { projectBuiltinTools, turnKindForOrigin } from "../tools/issuance";
import { skillRequirementSatisfied } from "../skills-management/skill-requirements";

export async function finalizeSkillsTurnProjection(input: Readonly<{
  context: AgentContext;
  policy: BuiltinTurnToolPolicy;
  catalog: SkillsCatalog;
  custody: SkillsTurnCustodyStore;
}>): Promise<AgentContext> {
  const projectionInput = input.context.turnProjectionInput;
  if (!projectionInput) return input.context;
  if (input.context.skillsCustodyId && input.context.finalTurnProjection) {
    return input.context;
  }

  const runtimeRoot = input.policy.builtinTools === "none"
    ? null
    : await input.custody
      .reserveRuntimeRoot(projectionInput.requestId)
      .catch(() => null);
  const capableFacts = {
    backend: projectionInput.backendId,
    useSkillRegistered: true,
    exactIssued: input.policy.builtinTools !== "none",
    autoApproved: input.policy.builtinTools !== "none",
    runtimeRootReadable: runtimeRoot !== null,
  } as const;
  const frozenAllowedTools = projectBuiltinTools({
    builtinTools: input.policy.builtinTools,
    backend: projectionInput.backendId,
    planMode: projectionInput.planMode,
    origin: projectionInput.origin,
    disabledTools: input.policy.disabledTools,
    useSkill: false,
  });
  const policyDigest =
    input.context.preparedProjectTools?.receipt.digest ??
    `legacy:${projectionInput.requestId}`;
  for (const skill of
    input.context.preparedProjectTools?.receipt.explicitSkills ?? []) {
    if (
      skill.requirement &&
      !skillRequirementSatisfied(skill.requirement, frozenAllowedTools)
    ) {
      throw new Error(
        `SKILL_REQUIREMENT_UNMET_AFTER_RUNTIME_CAS:${skill.name}:${skill.requirement}`
      );
    }
  }
  const toolPolicy = { allowedTools: frozenAllowedTools, policyDigest };
  const snapshot = input.context.preparedSkillSelection
    ? await input.catalog.effectiveSnapshotFromPrepared(
        input.context.preparedSkillSelection,
        capableFacts,
        toolPolicy
      )
    : await input.catalog.effectiveSnapshotForWorkspace(
        input.context.workspace,
        projectionInput.backendId,
        projectionInput.planMode,
        capableFacts,
        false,
        input.context.projectContext ?? {
          projectId: null,
          projectLifecycleRevision: null,
        },
        toolPolicy
      );
  const custodyId = await input.custody.begin({
    requestId: projectionInput.requestId,
    conversationId: projectionInput.conversationId,
    ownerId: input.context.preparedSkillSelection?.refOwnerId,
    snapshot,
    runtimeRoot,
  });
  const allowedTools = projectBuiltinTools({
    builtinTools: input.policy.builtinTools,
    backend: projectionInput.backendId,
    planMode: projectionInput.planMode,
    origin: projectionInput.origin,
    disabledTools: input.policy.disabledTools,
    useSkill: snapshot.capable,
  });
  const readOnlyRoots = input.context.filesystemAccess?.readOnlyRoots;

  return {
    ...input.context,
    skillsCustodyId: custodyId,
    ...(runtimeRoot ? { skillsRuntimeRoot: runtimeRoot } : {}),
    ...(input.context.filesystemAccess
      ? {
          filesystemAccess: {
            ...input.context.filesystemAccess,
            readOnlyRoots: [
              ...(readOnlyRoots ?? []),
              ...(runtimeRoot ? [runtimeRoot] : []),
            ],
          },
        }
      : {}),
    finalTurnProjection: createFinalTurnProjection({
      turnKind: turnKindForOrigin(projectionInput.origin),
      allowedTools,
      appInstructions: input.context.attachedAppInstructions ?? "",
      skillsCapable: snapshot.capable,
      skills: snapshot.entries
        .filter((entry) => entry.available)
        .map((entry) => ({
          name: entry.slug,
          scope: entry.sourceKind,
          description: entry.metadata.description,
          ...(entry.metadata.displayName
            ? { displayName: entry.metadata.displayName }
            : {}),
          ...(entry.requires ? { requires: entry.requires } : {}),
        })),
    }),
  };
}
