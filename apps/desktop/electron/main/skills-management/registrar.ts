/**
 * [INPUT]: Depends on Electron BrowserWindow, rendererIpc, shared unified Skills channels and UnifiedSkillsService
 * [OUTPUT]: Provides registerUnifiedSkills with unified public error code mapping, binding library/candidate/import/precise authority/action/session file with changed and pushing to the host window
 * [POS]: The skills-management renderer IPC is the adaptive layer; All the original exceptions are only recorded in the main, and the renderer only receives a pathless stable error
 */

import type { BrowserWindow } from "electron";
import {
  UNIFIED_SKILLS_CHANNEL,
  UNIFIED_SKILLS_ERROR,
  type ManagedSkillAgent,
  type UnifiedSkillsSnapshot,
} from "../../../shared/unified-skills-ipc";
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
  rendererIpc(window, rendererUrl, "拒绝非主窗口的统一 Skills 请求")
    .handle(UNIFIED_SKILLS_CHANNEL.list, (forceReload) => guarded("list", () => service.list(forceReload === true)))
    .handle(UNIFIED_SKILLS_CHANNEL.candidates, (agent, forceReload) =>
      guarded("candidates", () => service.candidates(agent as ManagedSkillAgent, forceReload === true))
    )
    .handle(UNIFIED_SKILLS_CHANNEL.import, (input) =>
      guarded("import", () => service.import(input as Parameters<UnifiedSkillsService["import"]>[0]))
    )
    .handle(UNIFIED_SKILLS_CHANNEL.previewAction, (input) =>
      guarded("preview-action", () => service.previewAction(input as Parameters<UnifiedSkillsService["previewAction"]>[0]))
    )
    .handle(UNIFIED_SKILLS_CHANNEL.authorizeAction, (previewId) =>
      guarded("authorize-action", () => service.authorizeAction(previewId as string))
    )
    .handle(UNIFIED_SKILLS_CHANNEL.applyAction, (input) =>
      guarded("apply-action", () => service.applyAction(input as Parameters<UnifiedSkillsService["applyAction"]>[0]))
    )
    .handle(UNIFIED_SKILLS_CHANNEL.setProduct, (input) =>
      guarded("set-product", () => service.setProduct(input as Parameters<UnifiedSkillsService["setProduct"]>[0]))
    )
    .handle(UNIFIED_SKILLS_CHANNEL.dismissOnboarding, () => guarded("dismiss-onboarding", () => service.dismissOnboarding()));
  window.once("closed", unsubscribe);
}

async function guarded<T>(operation: string, run: () => Promise<T>) {
  try {
    return await run();
  } catch (cause) {
    console.error(`[unified-skills:${operation}]`, cause);
    throw toUnifiedSkillsPublicError(cause);
  }
}

/* 自定义属性穿不过 Electron 的 IPC 错误序列化，只有 message 到得了对岸。
   所以码就走 message：三种结局三个码，人话在 renderer 的目录里。 */
export function toUnifiedSkillsPublicError(cause: unknown) {
  const status = Number((cause as { status?: unknown } | null)?.status);
  if (status === 409) {
    return Object.assign(new Error(UNIFIED_SKILLS_ERROR.conflict), { status });
  }
  if (status === 503) {
    return Object.assign(new Error(UNIFIED_SKILLS_ERROR.readOnly), { status });
  }
  return Object.assign(new Error(UNIFIED_SKILLS_ERROR.failed), { status: 500 });
}
