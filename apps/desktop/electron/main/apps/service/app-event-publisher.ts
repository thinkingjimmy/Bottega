/**
 * [INPUT]: Depends on renderer-event-bus, the Apps event channel, Design preset identity, the current main window, and Skill invalidation
 * [OUTPUT]: Provides publishAppEvent for ownership-scoped durable App status/removal/runtime projections
 * [POS]: The apps service event edge; it keeps renderer routing policy out of the AppsService composition root
 */

import type { BrowserWindow } from "electron";
import { APPS_CHANNEL, type AppInstallEvent } from "../../../../shared/apps-ipc";
import { DESIGN_PRESET_ID } from "../../design/enabled";
import { rendererEventBus } from "../../window/surfaces/renderer-event-bus";

export function publishAppEvent(input: {
  event: AppInstallEvent;
  window: BrowserWindow | null;
  invalidateSkills: (() => void) | null;
}) {
  const { event } = input;
  if (event.type === "status" && event.record.presetId === DESIGN_PRESET_ID) {
    input.invalidateSkills?.();
  }
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
