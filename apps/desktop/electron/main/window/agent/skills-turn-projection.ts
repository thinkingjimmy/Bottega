/**
 * [INPUT]: Uses `../../sections/coordinator/turns/mode-admission`, `../../agent/bridge/bridge-types`, `../../agent/admission/product-context`, `../../skills/catalog/skills-catalog`, `../../skills-management/custody/turn-custody`, `../../tools/issuance`, `../../skills-management/metadata/skill-requirements`, `../../sections/coordinator/admission/prepared-manual-text` for its declared types and implementation.
 * [OUTPUT]: Provides finalizeSkillsTurnProjection.
 * [POS]: apps/desktop/electron/main/window/agent module boundary; adjacent modules consume its explicit exports.
 */

import { modeToolSelection, resolveChatMode } from "../../sections/coordinator/turns/mode-admission";
import type {
  AgentContext,
  BuiltinTurnToolPolicy,
} from "../../agent/bridge/bridge-types";
import { createFinalTurnProjection } from "../../agent/admission/product-context";
import type { SkillsCatalog } from "../../skills/catalog/skills-catalog";
import type { SkillsTurnCustodyStore } from "../../skills-management/custody/turn-custody";
import { projectBuiltinTools, turnKindForOrigin } from "../../tools/issuance";

import { skillRequirementSatisfied } from "../../skills-management/metadata/skill-requirements";


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
  const mode=resolveChatMode({backend:projectionInput.backendId,mode:projectionInput.mode});
  const selectedTools=modeToolSelection({backend:projectionInput.backendId,mode:projectionInput.mode});
  const frozenAllowedTools = projectBuiltinTools({
    ...selectedTools,
    builtinTools: input.policy.builtinTools,
    backend: projectionInput.backendId,
    planMode: projectionInput.planMode,
    origin: projectionInput.origin,
    disabledTools: input.policy.disabledTools,
    useSkill: false,
    managedWorktreeCommit: input.context.managedWorktree,
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
  const preparedSkillSelection = input.context.preparedSkillSelection;
  const snapshot = preparedSkillSelection
    ? await input.catalog.effectiveSnapshotFromPrepared(
        preparedSkillSelection,
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
  const projectedTools = projectBuiltinTools({
    ...selectedTools,
    builtinTools: input.policy.builtinTools,
    backend: projectionInput.backendId,
    planMode: projectionInput.planMode,
    origin: projectionInput.origin,
    disabledTools: input.policy.disabledTools,
    useSkill: snapshot.capable,
    managedWorktreeCommit: input.context.managedWorktree,
  });
  const allowedTools = projectedTools.filter(name => name !== "read_chat_history" || Boolean(projectionInput.handoff));
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
      handoff: projectionInput.handoff, freshSession: projectionInput.freshSession,
      allowedTools,
      appInstructions: [mode.prompt,input.context.attachedAppInstructions].filter(Boolean).join("\n\n"),
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
