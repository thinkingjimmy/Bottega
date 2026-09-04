/**
 * [INPUT]: Depends on durable generation compatibility refs, exact Base GUI grant projections, and the fixed participant id registry
 * [OUTPUT]: Provides the deterministic frozen participant id plan plus registry-order validation
 * [POS]: gui-cutover participant authority; the plan is frozen before the commit point, so no App-controlled identifier enters it and recovery never re-derives it after the CAS
 */

import type { AppGeneration, AppRecord } from "../../../../shared/apps-ipc";
import {
  GUI_CUTOVER_PARTICIPANT_IDS,
  type GuiCutoverParticipantIdV1,
} from "../../../../shared/app-gui/cutover";
import type { BaseGuiGrantStore } from "../base-gui/grant-store";

/* 注册表就是这条有序元组本身：计划里的每个 id 必须存在、唯一，并且严格
   按注册顺序出现。少一层 Record 就少一份可能与元组失配的真相。 */
export function deriveParticipantPlan(
  record: AppRecord,
  previous: AppGeneration | null,
  next: AppGeneration,
  grants: BaseGuiGrantStore
): readonly GuiCutoverParticipantIdV1[] {
  const generations = [previous, next].filter((item): item is AppGeneration => Boolean(item));
  const projections = generations.map((generation) => ({
    generation,
    grant: grants.projection(record.id, generation.generationId),
  }));
  const plan: GuiCutoverParticipantIdV1[] = ["core-projection-v1", "core-bootstrap-v1"];
  if (projections.some(({ generation }) =>
    generation.compatibilityRef?.kind === "compiled-v3" &&
    generation.compatibilityRef.dataSdk.kind === "base-gui-data-v1"
  )) {
    plan.push("base-query-v1", "base-revision-event-v1");
  }
  if (generations.some((generation) =>
    generation.compatibilityRef?.kind === "compiled-v3" &&
    generation.compatibilityRef.preferences.kind === "app-preferences-v1"
  )) plan.push("preferences-v1");
  if (projections.some(({ generation, grant }) =>
    generation.compatibilityRef?.kind === "compiled-v3" &&
    generation.compatibilityRef.workspace.kind === "workspace-read-v1" &&
    grant.capabilities.includes("workspace-read") &&
    grant.capabilityScopes.workspaceRead === "design/"
  )) plan.push("workspace-read-v1");
  if (projections.some(({ generation, grant }) =>
    generation.compatibilityRef?.kind === "compiled-v3" &&
    generation.compatibilityRef.hostActions.kind === "host-actions-v1" &&
    generation.compatibilityRef.hostActions.required.includes("file.export") &&
    grant.hostActions.includes("file.export")
  )) plan.push("file-export-v1");
  return validateParticipantPlan(plan);
}

export function validateParticipantPlan(
  plan: readonly GuiCutoverParticipantIdV1[]
): readonly GuiCutoverParticipantIdV1[] {
  let previousIndex = -1;
  for (const participantId of plan) {
    const index = GUI_CUTOVER_PARTICIPANT_IDS.indexOf(participantId);
    if (index <= previousIndex) throw new Error("GUI_CUTOVER_PARTICIPANT_PLAN_INVALID");
    previousIndex = index;
  }
  if (
    !plan.includes("core-projection-v1") ||
    !plan.includes("core-bootstrap-v1")
  ) throw new Error("GUI_CUTOVER_CORE_PARTICIPANT_MISSING");
  return [...plan];
}
