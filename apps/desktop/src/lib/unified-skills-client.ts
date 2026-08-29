/**
 * [INPUT]: Depends on the preload unifiedSkills bridge, shared intent/job DTOs, and ProductResult unwrapping
 * [OUTPUT]: Provides renderer calls for Skills commands, import-all onboarding, full snapshot changes, and lightweight job-progress events
 * [POS]: Thin renderer boundary for unified Skills; views never inspect IPC envelopes or touch native paths
 */

import type {
  ManagedSkillAgent,
  ManagedSkillJobProgress,
  UnifiedSkillsBridgeApi,
  UnifiedSkillsSnapshot,
} from "../../shared/unified-skills-ipc";
import { unwrapProductResult } from "../../shared/product-failure";

declare global {
  interface Window {
    unifiedSkills?: UnifiedSkillsBridgeApi;
  }
}

function bridge() {
  if (!window.unifiedSkills) throw new Error("Unified Skills management is unavailable");
  return window.unifiedSkills;
}

export const listUnifiedSkills = async (forceReload = false) =>
  unwrapProductResult(await bridge().list(forceReload));

export const listUnifiedSkillCandidates = async (
  agent: ManagedSkillAgent | "all",
  forceReload = false
) => unwrapProductResult(await bridge().candidates(agent, forceReload));

export const chooseLocalSkillsFolder = async () =>
  unwrapProductResult(await bridge().chooseLocal());

export const previewUnifiedSkillIntents = async (
  intents: Parameters<UnifiedSkillsBridgeApi["previewIntents"]>[0]
) => unwrapProductResult(await bridge().previewIntents(intents));

export const applyUnifiedSkillPlan = async (
  input: Parameters<UnifiedSkillsBridgeApi["applyPlan"]>[0]
) => unwrapProductResult(await bridge().applyPlan(input));

export const undoUnifiedSkillPlan = async (undoToken: string) =>
  unwrapProductResult(await bridge().undoPlan(undoToken));

export const onUnifiedSkillsChanged = (listener: (snapshot: UnifiedSkillsSnapshot) => void) =>
  window.unifiedSkills?.onChanged(listener) ?? (() => {});

export const onUnifiedSkillsProgress = (listener: (progress: ManagedSkillJobProgress) => void) =>
  window.unifiedSkills?.onProgress(listener) ?? (() => {});

/** Import every currently actionable discovered Skill into the personal Library. */
export async function importAllDiscoveredSkills() {
  const preview = await listUnifiedSkillCandidates("all", false);
  const candidateRefs = preview.candidates
    .filter((candidate) => candidate.importable && candidate.status !== "current")
    .map((candidate) => candidate.ref);
  if (!candidateRefs.length) return listUnifiedSkills();
  const plan = await previewUnifiedSkillIntents([{
    type: "import-and-enable",
    previewId: preview.previewId,
    revision: preview.revision,
    candidateRefs,
  }]);
  if (plan.consent.length) {
    throw new Error("Skills onboarding import unexpectedly requested destructive consent");
  }
  return applyUnifiedSkillPlan({
    planId: plan.planId,
    planDigest: plan.planDigest,
    authorityToken: plan.authorityToken,
  });
}
