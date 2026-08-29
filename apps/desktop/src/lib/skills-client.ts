/**
 * [INPUT]: Depends on shared Skills IPC, ProductResult unwrapping, and preload window.skills
 * [OUTPUT]: Provides structured catalog results, Plan capability, and invalidated-ref event subscription
 * [POS]: Renderer runtime Skills boundary; callers never decode IPC envelopes or main exceptions
 */

import type {
  SkillsBridgeApi,
  SkillsChangedEvent,
  SkillsListInput,
  SkillsListResult,
  SkillsScope,
} from "../../shared/skills-ipc";
import { unwrapProductResult } from "../../shared/product-failure";

declare global {
  interface Window {
    skills?: SkillsBridgeApi;
  }
}

const emptyResult: SkillsListResult = {
  skills: [],
  truncated: false,
  matchedCount: 0,
  hiddenCount: 0,
};

export async function listSkills(input: SkillsListInput): Promise<SkillsListResult> {
  return window.skills ? unwrapProductResult(await window.skills.list(input)) : emptyResult;
}

export async function loadSkillCapabilities(scope: SkillsScope) {
  return window.skills
    ? unwrapProductResult(await window.skills.capabilities(scope))
    : { plan: false };
}

export function onSkillsChanged(callback: (event: SkillsChangedEvent) => void) {
  return window.skills?.onChanged(callback) ?? (() => {});
}
