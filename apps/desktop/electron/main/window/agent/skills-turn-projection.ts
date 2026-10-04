/**
 * [INPUT]: Depends on Prepared Skill receipts, effective catalog snapshots, custody, builtin policy and workflow turn authority.
 * [OUTPUT]: Provides finalizeSkillsTurnProjection; selected workflow Skills must remain capable and complete before exact use_skill issuance.
 * [POS]: apps/desktop/electron/main/window/agent; Final turn projection shared by builtin Providers; workflows never fall back to ambient Skills.
 */

import type {
  AgentContext,
  BuiltinTurnToolPolicy,
} from "../../agent/bridge/bridge-types";
import { createFinalTurnProjection } from "../../agent/admission/product-context";
import type { SkillsCatalog } from "../../skills/catalog/skills-catalog";
import type { SkillsTurnCustodyStore } from "../../skills-management/custody/turn-custody";
import { projectBuiltinTools, turnKindForOrigin } from "../../tools/issuance";
import { workflowTurnPolicyFor } from "../../workflows/turn-policy";
import { skillRequirementSatisfied } from "../../skills-management/metadata/skill-requirements";
import { emptyPreparedSkillSelection } from "../../sections/coordinator/admission/prepared-manual-text";

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
    managedWorktreeCommit: input.context.managedWorktree,
    workflowStepResult: input.policy.workflowStep === true,
    workflowStepHistory: Boolean(workflowTurnPolicyFor(projectionInput.requestId)?.historyChatId),
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
  /* A role consumes its main-owned frozen selection; without one, ambient Skills stay excluded. */
  const preparedSkillSelection = input.context.preparedSkillSelection ?? (projectionInput.origin?.kind === "workflow"
    ? emptyPreparedSkillSelection(projectionInput.requestId, projectionInput.backendId, projectionInput.planMode,
      input.context.projectContext ?? { projectId: null, projectLifecycleRevision: null })
    : undefined);
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
  if (projectionInput.origin?.kind === "workflow" && (snapshot.entries.some(entry => !entry.available)
    || snapshot.entries.length !== preparedSkillSelection?.candidates.length
    || (snapshot.entries.length > 0 && !snapshot.capable))) {
    throw new Error("agent-config-skill-unavailable");
  }
  const custodyId = await input.custody.begin({
    requestId: projectionInput.requestId,
    conversationId: projectionInput.conversationId,
    ownerId: input.context.preparedSkillSelection?.refOwnerId,
    snapshot,
    runtimeRoot,
  });
  const projectedTools = projectBuiltinTools({
    builtinTools: input.policy.builtinTools,
    backend: projectionInput.backendId,
    planMode: projectionInput.planMode,
    origin: projectionInput.origin,
    disabledTools: input.policy.disabledTools,
    useSkill: snapshot.capable,
    managedWorktreeCommit: input.context.managedWorktree,
    workflowStepResult: input.policy.workflowStep === true,
    workflowStepHistory: Boolean(workflowTurnPolicyFor(projectionInput.requestId)?.historyChatId),
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
