/**
 * [INPUT]: Depends on the main BrowserWindow, power monitor, renderer-scoped IPC, strict requests and the history/quota service owners.
 * [OUTPUT]: Provides main-window history/quota IPC (the quota snapshot is also readable by an App window holding its Studio, and quota changes reach App windows), strict consumer demand, a refresh whose absent request means every Agent, a Finder reveal of the file that routes an Agent to a custom endpoint (main resolves the path), and visibility/power lifecycle cleanup (foreground = shown and not minimized)
 * [POS]: apps/desktop/electron/main/window/agent; Main-window registrar composed by createMainWindow alongside the other domain registrars
 */

import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { powerMonitor, shell, type BrowserWindow } from "electron";
import { USAGE_CHANNEL } from "../../../../shared/ipc/settings/usage-ipc";
import { LIMITS_CHANNEL } from "../../../../shared/usage-limits/types";
import { limitsDemandSchema, limitsRefreshSchema, limitsRevealSchema } from "../../../../shared/usage-limits/schema";
import type { AgentUsageLimitsService } from "../../usage-limits/service";
import { quotaRouteConfig } from "../../usage-limits/source";
import { rendererIpc } from "../../registration/ipc-registrar";
import { surfaceWindowController } from "../surfaces/surface-window-controller";
import type { TrustedRendererContext } from "../surfaces/trusted-renderer-context";
import { windowRegistry } from "../surfaces/window-registry";
import { assertUsageRequest, type UsageService } from "../../usage/usage-service";

export function registerUsage(
  window: BrowserWindow,
  rendererUrl: string,
  usage: UsageService,
  limits?: AgentUsageLimitsService,
  {
    register = rendererIpc,
    monitor = powerMonitor,
    assertRead = (context: TrustedRendererContext) => surfaceWindowController.assertStudioRead(context),
    publishToAppWindows = (channel: string, value: unknown) => { windowRegistry.publish(channel, value, (record) => record.role === "app-window"); },
  }: {
    register?: typeof rendererIpc;
    monitor?: Pick<typeof powerMonitor, "on" | "removeListener">;
    assertRead?: (context: TrustedRendererContext) => void;
    publishToAppWindows?: (channel: string, value: unknown) => void;
  } = {}
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
    /* The snapshot is a read: an App window holding its Studio shows the same quota in its composer. Demand and refresh stay main-only. */
    .roles("main", "app-window")
    .handleWithContext(LIMITS_CHANNEL.snapshot, (context, ...args) => {
      assertRead(context);
      if (args.length) throw new Error("Quota snapshots accept no arguments");
      return limits.snapshot();
    })
    .roles("main")
    .handle(LIMITS_CHANNEL.demand, (...args) => {
      if (args.length !== 1) throw new Error("Quota demand requires one object");
      limits.setDemand(limitsDemandSchema.parse(args[0]));
      return limits.snapshot();
    })
    .handle(LIMITS_CHANNEL.refresh, (...args) => {
      if (args.length > 1) throw new Error("Quota refresh accepts at most one object");
      /* `refresh()` from the preload arrives as one undefined argument: an absent request means every Agent, not an error. */
      return limits.refresh(limitsRefreshSchema.parse(args[0] === undefined ? {} : args[0]));
    })
    .handle(LIMITS_CHANNEL.revealRouteConfig, async (...args) => {
      if (args.length !== 1) throw new Error("Route config reveal requires one object");
      const { backend } = limitsRevealSchema.parse(args[0]);
      const path = limits.known(backend) ? quotaRouteConfig(backend) : null;
      if (!path) throw new Error("This Agent has no route config");
      /* Selects the file when it is there; a route set by the environment alone leaves only its folder to open. */
      if (existsSync(path)) shell.showItemInFolder(path);
      else { const failure = await shell.openPath(dirname(path)); if (failure) throw new Error(failure); }
    });
  /* On screen is what counts, not focus: a Usage page someone is reading while typing elsewhere is still watched, and
     focus taken by another app or a CLI that opens a window must not cancel a read nobody would then owe again. */
  const foreground = () => limits.setForeground(!window.isDestroyed() && window.isVisible() && !window.isMinimized());
  const suspend = () => limits.setForeground(false);
  const resume = () => { suspend(); foreground(); };
  const clear = () => limits.clearDemands();
  const release = limits.subscribe((value) => {
    if (!window.isDestroyed()) window.webContents.send(LIMITS_CHANNEL.changed, value);
    publishToAppWindows(LIMITS_CHANNEL.changed, value);
  });
  window.on("show", foreground).on("hide", foreground).on("minimize", foreground).on("restore", foreground);
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
