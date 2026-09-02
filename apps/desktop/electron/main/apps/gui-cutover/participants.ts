/**
 * [INPUT]: Depends on durable generation compatibility refs, exact Base GUI grant projections, the fixed participant registry, and canonical digesting
 * [OUTPUT]: Provides deterministic frozen participant plans, exact registry validation, plan digests, and app/surface evidence identities bound to those digests
 * [POS]: gui-cutover participant authority; the plan is frozen before the commit point, so no App-controlled identifier or operation enters it and recovery never re-derives it after the CAS
 */

import type { AppGeneration, AppRecord } from "../../../../shared/apps-ipc";
import {
  GUI_CUTOVER_PARTICIPANT_IDS,
  type AppGuiGenerationIntent,
  type GuiCutoverParticipantEvidence,
  type GuiCutoverParticipantIdV1,
  type GuiCutoverParticipantPlanEntry,
  type GuiSideEffectKindV1,
  type GuiStagingOperationV1,
} from "../../../../shared/app-gui/cutover";
import type { BaseGuiGrantStore } from "../base-gui/grant-store";
import { canonicalDigest } from "../gui-build/metadata";

type RegistryEntry = Readonly<{
  contractVersion: string;
  scope: GuiCutoverParticipantPlanEntry["scope"];
  stagingOperations: readonly GuiStagingOperationV1[];
  sideEffectKinds: readonly GuiSideEffectKindV1[];
}>;

const REGISTRY: Readonly<Record<GuiCutoverParticipantIdV1, RegistryEntry>> = {
  "core-projection-v1": { contractVersion: "core-projection-v1", scope: "app", stagingOperations: [], sideEffectKinds: [] },
  "core-bootstrap-v1": { contractVersion: "core-bootstrap-v1", scope: "surface", stagingOperations: ["bootstrap.first-paint"], sideEffectKinds: [] },
  "legacy-side-effects-v1": { contractVersion: "legacy-side-effects-v1", scope: "app", stagingOperations: [], sideEffectKinds: ["legacy-base-mutation", "legacy-navigation", "legacy-compose-text"] },
  "base-query-v1": { contractVersion: "base-gui-query-v1", scope: "app-and-surface", stagingOperations: ["base.meta", "base.query-v1", "attachment.read"], sideEffectKinds: [] },
  "base-revision-event-v1": { contractVersion: "base-revision-event-v1", scope: "app-and-surface", stagingOperations: ["base.revision-event"], sideEffectKinds: [] },
  "base-mutation-v1": { contractVersion: "base-mutation-v1", scope: "app", stagingOperations: [], sideEffectKinds: ["base-mutation"] },
  "preferences-v1": { contractVersion: "app-preferences-v1", scope: "app-and-surface", stagingOperations: ["preferences.preview"], sideEffectKinds: ["preferences-write", "preferences-adopt"] },
  "workspace-read-v1": { contractVersion: "workspace-read-v1", scope: "app-and-surface", stagingOperations: ["workspace.files", "workspace.versions", "workspace.source-line", "workspace.opaque-preview"], sideEffectKinds: [] },
  "host-actions-v1": { contractVersion: "host-actions-v1", scope: "app", stagingOperations: [], sideEffectKinds: ["host-navigation", "host-compose-text"] },
  "file-export-v1": { contractVersion: "file-export-v1", scope: "app", stagingOperations: [], sideEffectKinds: ["file-export"] },
};

export function deriveParticipantPlan(
  record: AppRecord,
  previous: AppGeneration | null,
  next: AppGeneration,
  grants: BaseGuiGrantStore
): readonly GuiCutoverParticipantPlanEntry[] {
  const generations = [previous, next].filter((item): item is AppGeneration => Boolean(item));
  const projections = generations.map((generation) => ({
    generation,
    grant: grants.projection(record.id, generation.generationId),
  }));
  const plan: GuiCutoverParticipantPlanEntry[] = [entry("core-projection-v1"), entry("core-bootstrap-v1")];
  if (previous && legacyEffects(previous, grants.projection(record.id, previous.generationId)).length) {
    plan.push(entry("legacy-side-effects-v1", [], legacyEffects(previous, grants.projection(record.id, previous.generationId))));
  }
  const data = projections.filter(({ generation }) =>
    generation.compatibilityRef?.kind === "compiled-v3" &&
    generation.compatibilityRef.dataSdk.kind === "base-gui-data-v1"
  );
  if (data.length) {
    const attachment = data.some(({ grant }) => grant.capabilities.includes("attachment-read"));
    plan.push(entry("base-query-v1", ["base.meta", "base.query-v1", ...(attachment ? ["attachment.read" as const] : [])]));
    plan.push(entry("base-revision-event-v1"));
  }
  if (projections.some(({ grant }) => grant.capabilities.some(isRowMutation))) {
    plan.push(entry("base-mutation-v1"));
  }
  if (generations.some((generation) =>
    generation.compatibilityRef?.kind === "compiled-v3" &&
    generation.compatibilityRef.preferences.kind === "app-preferences-v1"
  )) plan.push(entry("preferences-v1"));
  if (projections.some(({ generation, grant }) =>
    generation.compatibilityRef?.kind === "compiled-v3" &&
    generation.compatibilityRef.workspace.kind === "workspace-read-v1" &&
    grant.capabilities.includes("workspace-read") &&
    grant.capabilityScopes.workspaceRead === "design/"
  )) plan.push(entry("workspace-read-v1"));
  const host = projections.filter(({ generation }) =>
    generation.compatibilityRef?.kind === "compiled-v3" &&
    generation.compatibilityRef.hostActions.kind === "host-actions-v1"
  );
  if (host.length) {
    const compose = host.some(({ generation, grant }) =>
      generation.compatibilityRef?.kind === "compiled-v3" &&
      generation.compatibilityRef.hostActions.kind === "host-actions-v1" &&
      generation.compatibilityRef.hostActions.required.includes("compose-text") &&
      grant.hostActions.includes("compose-text")
    );
    plan.push(entry("host-actions-v1", [], ["host-navigation", ...(compose ? ["host-compose-text" as const] : [])]));
  }
  if (host.some(({ generation, grant }) =>
    generation.compatibilityRef?.kind === "compiled-v3" &&
    generation.compatibilityRef.hostActions.kind === "host-actions-v1" &&
    generation.compatibilityRef.hostActions.required.includes("file.export") &&
    grant.hostActions.includes("file.export")
  )) plan.push(entry("file-export-v1"));
  return validateParticipantPlan(plan);
}

export function validateParticipantPlan(plan: readonly GuiCutoverParticipantPlanEntry[]) {
  const ids = new Set<GuiCutoverParticipantIdV1>();
  let previousIndex = -1;
  for (const candidate of plan) {
    const index = GUI_CUTOVER_PARTICIPANT_IDS.indexOf(candidate.participantId);
    const registered = REGISTRY[candidate.participantId];
    if (!registered || ids.has(candidate.participantId) || index <= previousIndex) {
      throw new Error("GUI_CUTOVER_PARTICIPANT_PLAN_INVALID");
    }
    if (
      candidate.contractVersion !== registered.contractVersion ||
      candidate.scope !== registered.scope ||
      candidate.stagingOperations.some((operation) => !registered.stagingOperations.includes(operation)) ||
      candidate.sideEffectKinds.some((effect) => !registered.sideEffectKinds.includes(effect))
    ) throw new Error("GUI_CUTOVER_PARTICIPANT_PLAN_INVALID");
    ids.add(candidate.participantId);
    previousIndex = index;
  }
  if (!ids.has("core-projection-v1") || !ids.has("core-bootstrap-v1")) {
    throw new Error("GUI_CUTOVER_CORE_PARTICIPANT_MISSING");
  }
  return structuredClone(plan);
}

export function participantPlanDigest(plan: readonly GuiCutoverParticipantPlanEntry[]) {
  return canonicalDigest({ schema: "bottega.gui-cutover-participant-plan/v1", plan: validateParticipantPlan(plan) });
}

export function participantEvidence(
  intent: AppGuiGenerationIntent,
  scope: "app" | "surface",
  context: Readonly<Record<string, unknown>> = {}
): readonly GuiCutoverParticipantEvidence[] {
  return intent.participantPlan
    .filter((item) => scope === "app" ? item.scope !== "surface" : item.scope !== "app")
    .map((item) => ({
      participantId: item.participantId,
      evidenceDigest: canonicalDigest({
        schema: "bottega.gui-cutover-participant-evidence/v1",
        participantPlanDigest: intent.participantPlanDigest,
        participant: item,
        scope,
        context,
      }),
    }));
}

function entry(
  participantId: GuiCutoverParticipantIdV1,
  stagingOperations = REGISTRY[participantId].stagingOperations,
  sideEffectKinds = REGISTRY[participantId].sideEffectKinds
): GuiCutoverParticipantPlanEntry {
  const registered = REGISTRY[participantId];
  return { participantId, contractVersion: registered.contractVersion, scope: registered.scope, stagingOperations, sideEffectKinds };
}

function isRowMutation(capability: string) {
  return capability === "row-insert" || capability === "row-patch" || capability === "row-delete";
}

function legacyEffects(
  generation: AppGeneration,
  grant: ReturnType<BaseGuiGrantStore["projection"]>
): GuiSideEffectKindV1[] {
  const effects: GuiSideEffectKindV1[] = [];
  if (generation.compatibilityRef?.kind === "static-v2") effects.push("legacy-navigation");
  if (grant.capabilities.some(isRowMutation)) effects.push("legacy-base-mutation");
  if (grant.hostActions.includes("compose-text")) effects.push("legacy-compose-text");
  return effects;
}
