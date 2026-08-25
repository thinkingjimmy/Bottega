/**
 * [INPUT]: Depends on preload Exposed window.unifiedSkills bridge and shared Unified Skills DTO
 * [OUTPUT]: Provides library/candidate/local selection/bulk import/precise authority action/Codex session file/changed renderer Thin boundaries
 * [POS]: The only input to the renderer is Unified Skills; The view does not directly touch the window, nor does it get an absolute path or durable operation
 */

import type {
  ManagedSkillAgent,
  UnifiedSkillsBridgeApi,
  UnifiedSkillsSnapshot,
} from "../../shared/unified-skills-ipc";

declare global {
  interface Window {
    unifiedSkills?: UnifiedSkillsBridgeApi;
  }
}

function bridge() {
  if (!window.unifiedSkills) throw new Error("当前环境不支持统一 Skills 管理");
  return window.unifiedSkills;
}

export const listUnifiedSkills = (forceReload = false) => bridge().list(forceReload);
export const listUnifiedSkillCandidates = (agent: ManagedSkillAgent, forceReload = false) => bridge().candidates(agent, forceReload);
export const importUnifiedSkills = (input: Parameters<UnifiedSkillsBridgeApi["import"]>[0]) => bridge().import(input);
export const previewUnifiedSkillAction = (input: Parameters<UnifiedSkillsBridgeApi["previewAction"]>[0]) => bridge().previewAction(input);
export const authorizeUnifiedSkillAction = (previewId: string) => bridge().authorizeAction(previewId);
export const applyUnifiedSkillAction = (input: Parameters<UnifiedSkillsBridgeApi["applyAction"]>[0]) => bridge().applyAction(input);
export const setUnifiedCodexProduct = (input: Parameters<UnifiedSkillsBridgeApi["setProduct"]>[0]) => bridge().setProduct(input);
export const dismissUnifiedSkillsOnboarding = () => bridge().dismissOnboarding();
export const onUnifiedSkillsChanged = (listener: (snapshot: UnifiedSkillsSnapshot) => void) =>
  window.unifiedSkills?.onChanged(listener) ?? (() => {});
