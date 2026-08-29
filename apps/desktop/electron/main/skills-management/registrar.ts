/**
 * [INPUT]: Depends on BrowserWindow, renderer IPC, unified Skills channels, ProductResult helpers, and UnifiedSkillsService
 * [OUTPUT]: Provides registerUnifiedSkills with envelope-only commands, full snapshot broadcasts, and lightweight job-progress events
 * [POS]: Skills management IPC adapter; exceptions are logged in main and reduced to domain-scoped pathless failures
 */

import type { BrowserWindow } from "electron";
import {
  UNIFIED_SKILLS_CHANNEL,
  type ManagedSkillAgent,
  type ManagedSkillJobProgress,
  type UnifiedSkillsSnapshot,
} from "../../../shared/unified-skills-ipc";
import {
  ProductFailureError,
  productFailed,
  productOk,
  skillsManagementFailure,
} from "../../../shared/product-failure";
import { rendererIpc } from "../ipc-registrar";
import type { UnifiedSkillsService } from "./service";

export function registerUnifiedSkills(
  window: BrowserWindow,
  rendererUrl: string,
  service: UnifiedSkillsService
) {
  const unsubscribe = service.onChanged((snapshot: UnifiedSkillsSnapshot) => {
    if (!window.isDestroyed()) window.webContents.send(UNIFIED_SKILLS_CHANNEL.changed, snapshot);
  });
  const unsubscribeProgress = service.onProgress((progress: ManagedSkillJobProgress) => {
    if (!window.isDestroyed()) window.webContents.send(UNIFIED_SKILLS_CHANNEL.progress, progress);
  });
  rendererIpc(window, rendererUrl, "Reject unified Skills requests outside the main window")
    .handle(UNIFIED_SKILLS_CHANNEL.list, (forceReload) =>
      guarded("list", () => service.list(forceReload === true)))
    .handle(UNIFIED_SKILLS_CHANNEL.candidates, (agent, forceReload) =>
      guarded("candidates", () => service.candidates(agent as ManagedSkillAgent, forceReload === true)))
    .handle(UNIFIED_SKILLS_CHANNEL.chooseLocal, () =>
      guarded("choose-local", () => service.chooseLocal()))
    .handle(UNIFIED_SKILLS_CHANNEL.previewIntents, (intents) =>
      guarded("preview-intents", () => service.previewIntents(
        intents as Parameters<UnifiedSkillsService["previewIntents"]>[0]
      )))
    .handle(UNIFIED_SKILLS_CHANNEL.applyPlan, (input) =>
      guarded("apply-plan", () => service.applyPlan(
        input as Parameters<UnifiedSkillsService["applyPlan"]>[0]
      )))
    .handle(UNIFIED_SKILLS_CHANNEL.undoPlan, (undoToken) =>
      guarded("undo-plan", () => service.undoPlan(undoToken as string)));
  window.once("closed", () => {
    unsubscribe();
    unsubscribeProgress();
  });
}

async function guarded<T>(operation: string, run: () => Promise<T>) {
  try {
    return productOk(await run());
  } catch (cause) {
    console.error(`[unified-skills:${operation}]`, cause);
    return productFailed<T>(toSkillsManagementFailure(cause));
  }
}

export function toSkillsManagementFailure(cause: unknown) {
  /* 已成形的结构化失败原样透传：把 runtime 域压成 management/failed
     等于把更准的话翻译成更糊的话。 */
  if (cause instanceof ProductFailureError) return cause.failure;
  const status = Number((cause as { status?: unknown } | null)?.status);
  return skillsManagementFailure(status === 409 ? "conflict" : status === 503 ? "read-only" : "failed");
}
