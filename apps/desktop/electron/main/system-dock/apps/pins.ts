/**
 * [INPUT]: Depends on DockService admission facts, validated pin input and the shared layout editing kernel.
 * [OUTPUT]: Provides setAppPinned for main-window App shortcuts with durable, idempotent layout writes.
 * [POS]: system-dock/apps pin boundary; the existing DockConfigStore remains the only layout owner.
 */
import type { DockSettingsSnapshot, SetAppPinned } from "../../../../shared/system-dock/ipc";
import { addItem, removeItem } from "../../../../shared/system-dock/placement";
import type { DockService } from "../service";

export async function setAppPinned(service: DockService, input: SetAppPinned): Promise<DockSettingsSnapshot> {
  if (!service.initialized) throw new Error("DOCK_NOT_READY");
  let addedId: string | null = null;
  await service.ports.config.edit((layout) => {
    // Check inside the serialized edit: a disable queued during the request must win.
    if (!service.capability.supported) throw new Error("DOCK_UNSUPPORTED");
    if (!service.ports.local.get().enabled) throw new Error("DOCK_DISABLED");
    const existing = layout.items.filter((item) => item.kind === "bottega-app" && item.appId === input.appId);
    if (!input.pinned) {
      for (const item of existing) {
        const result = removeItem(layout, item.id);
        if (!("failure" in result)) layout = result.layout;
      }
      return layout;
    }
    if (existing.length) return layout;
    const fact = service.ports.apps.fact(input.appId);
    if (fact.state !== "ready") throw new Error("DOCK_APP_UNAVAILABLE");
    const result = addItem(layout, { kind: "bottega-app", appId: input.appId, localApp: null, label: fact.label });
    if ("failure" in result) throw new Error(result.failure === "budget" ? "DOCK_LAYOUT_FULL" : "DOCK_APP_INVALID");
    addedId = result.itemId;
    return result.layout;
  });
  if (addedId && service.started) service.highlight(addedId);
  return service.settingsSnapshot();
}
