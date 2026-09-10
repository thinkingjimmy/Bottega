/**
 * [INPUT]: Depends on the main BrowserWindow, power monitor, renderer-scoped IPC, strict requests and the history/quota service owners.
 * [OUTPUT]: Provides main-window history/quota IPC, strict consumer demand and focus/power lifecycle cleanup
 * [POS]: Focused window registrar composed by createMainWindow alongside the other domain registrars
 */

import { powerMonitor, type BrowserWindow } from "electron";
import { USAGE_CHANNEL } from "../../../shared/usage-ipc";
import { LIMITS_CHANNEL } from "../../../shared/usage-limits/types";
import { limitsDemandSchema, limitsRefreshSchema } from "../../../shared/usage-limits/schema";
import type { AgentUsageLimitsService } from "../usage-limits/service";
import { rendererIpc } from "../ipc-registrar";
import { assertUsageRequest, type UsageService } from "../usage/usage-service";

export function registerUsage(
  window: BrowserWindow,
  rendererUrl: string,
  usage: UsageService,
  limits?: AgentUsageLimitsService,
  { register = rendererIpc, monitor = powerMonitor } = {}
) {
  usage.attachWindow(window);
  register(rendererUrl, "拒绝非主窗口的用量请求")
    .handle(USAGE_CHANNEL.getSummary, (rawTarget, rawOptions) => {
      const request = assertUsageRequest(rawTarget, rawOptions);
      return usage.getSummary(request.target, { forceRefresh: request.forceRefresh });
    })
    .handle(USAGE_CHANNEL.replayProgress, () => usage.replayProgress());
  let releaseLimits = () => {};
  window.once("closed", () => { usage.detachWindow(window); releaseLimits(); });
  if (!limits) return;
  register(rendererUrl, "Quota requests require the main window")
    .handle(LIMITS_CHANNEL.snapshot, (...args) => {
      if (args.length) throw new Error("Quota snapshots accept no arguments");
      return limits.snapshot();
    })
    .handle(LIMITS_CHANNEL.demand, (...args) => {
      if (args.length !== 1) throw new Error("Quota demand requires one object");
      limits.setDemand(limitsDemandSchema.parse(args[0]));
      return limits.snapshot();
    })
    .handle(LIMITS_CHANNEL.refresh, (...args) => {
      if (args.length > 1) throw new Error("Quota refresh accepts at most one object");
      return limits.refresh(limitsRefreshSchema.parse(args.length ? args[0] : {}));
    });
  const foreground = () => limits.setForeground(!window.isDestroyed() && window.isVisible() && !window.isMinimized() && window.isFocused());
  const suspend = () => limits.setForeground(false);
  const resume = () => { suspend(); foreground(); };
  const clear = () => limits.clearDemands();
  const release = limits.subscribe((value) => {
    if (!window.isDestroyed()) window.webContents.send(LIMITS_CHANNEL.changed, value);
  });
  window.on("focus", foreground).on("blur", foreground).on("show", foreground)
    .on("hide", foreground).on("minimize", foreground).on("restore", foreground);
  window.webContents.on("did-start-loading", clear);
  monitor.on("suspend", suspend);
  monitor.on("resume", resume);
  foreground();
  releaseLimits = () => {
    suspend(); clear(); release();
    monitor.removeListener("suspend", suspend);
    monitor.removeListener("resume", resume);
  };
}
