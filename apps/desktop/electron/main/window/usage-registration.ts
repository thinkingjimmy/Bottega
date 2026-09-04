/**
 * [INPUT]: Depends on the main BrowserWindow, renderer-scoped IPC, strict usage requests, and UsageService
 * [OUTPUT]: Provides lifecycle-bound main-window usage summary/progress IPC registration
 * [POS]: Focused window registrar composed by createMainWindow alongside the other domain registrars
 */

import type { BrowserWindow } from "electron";
import { USAGE_CHANNEL } from "../../../shared/usage-ipc";
import { rendererIpc } from "../ipc-registrar";
import { assertUsageRequest, type UsageService } from "../usage/usage-service";

export function registerUsage(
  window: BrowserWindow,
  rendererUrl: string,
  usage: UsageService
) {
  usage.attachWindow(window);
  rendererIpc(window, rendererUrl, "拒绝非主窗口的用量请求")
    .handle(USAGE_CHANNEL.getSummary, (rawTarget, rawOptions) => {
      const request = assertUsageRequest(rawTarget, rawOptions);
      return usage.getSummary(request.target, { forceRefresh: request.forceRefresh });
    })
    .handle(USAGE_CHANNEL.replayProgress, () => usage.replayProgress());
  window.once("closed", () => usage.detachWindow(window));
}
