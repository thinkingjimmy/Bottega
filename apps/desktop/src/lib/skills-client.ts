/**
 * [INPUT]: Depends on shared Skills IPC and preload window.skills; Browser environment without local catalog
 * [OUTPUT]: Provides listSkills/loadSkillCapabilities renderer boundaries
 * [POS]: The manual Skill/Plan capability client of renderer lib, hiding the Electron branch of the bridge
 */

import type {
  SkillInfo,
  SkillsBridgeApi,
  SkillsListInput,
  SkillsScope,
} from "../../shared/skills-ipc";

declare global {
  interface Window {
    skills?: SkillsBridgeApi;
  }
}

export function listSkills(input: SkillsListInput): Promise<SkillInfo[]> {
  return window.skills?.list(input) ?? Promise.resolve([]);
}

export function loadSkillCapabilities(scope: SkillsScope) {
  return window.skills?.capabilities(scope) ?? Promise.resolve({ plan: false });
}
