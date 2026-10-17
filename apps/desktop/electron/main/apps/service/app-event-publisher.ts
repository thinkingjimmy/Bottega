/**
 * [INPUT]: Renderer event routing, Apps channel, explicit retirement guard, current main window and Skill invalidation.
 * [OUTPUT]: Owner-scoped App status/removal/runtime events excluding retired Design installations without deleting stored data.
 * [POS]: The apps service event edge; it keeps renderer routing policy out of the AppsService composition root
 */

import type { BrowserWindow } from "electron";
import { APPS_CHANNEL, type AppInstallEvent } from "../../../../shared/ipc/apps/apps-ipc";
import { rendererEventBus } from "../../window/surfaces/renderer-event-bus";
import { isRetiredApp } from "./availability/guard";

export function publishAppEvent(input: {
  event: AppInstallEvent;
  window: BrowserWindow | null;
  invalidateSkills: (() => void) | null;
}) {
  const { event } = input;
  if (event.type === "status" && isRetiredApp(event.record)) return;
  let delivered = rendererEventBus.toRole("main", APPS_CHANNEL.event, event);
  if ("appId" in event) {
    delivered += rendererEventBus.toApp(
      event.appId,
      APPS_CHANNEL.event,
      event
    );
  }
  if (!delivered && input.window && !input.window.isDestroyed()) {
    input.window.webContents.send(APPS_CHANNEL.event, event);
  }
}
