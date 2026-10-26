/**
 * [INPUT]: Depends on AppsService records, shared display names, product window residence, main-owned window opening and localized native errors.
 * [OUTPUT]: Provides createDockApps for live App facts, standalone activation and bounded change subscriptions.
 * [POS]: system-dock/apps adapter; isolated Dock renderers receive display facts and never acquire product bridges.
 */
import { dialog } from "electron";
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import { translate } from "../../../../shared/i18n/runtime";
import { appDisplayName } from "../../../../shared/ipc/apps/apps-ipc";
import type { AppsService } from "../../apps/apps-service";
import { surfaceWindowController } from "../../window/surfaces/surface-window-controller";
import { windowRegistry } from "../../window/surfaces/window-registry";
import type { BottegaAppsPort } from "../service";

export function createDockApps(ports: { apps(): AppsService | null; locale(): AppLocale }) {
  const errors = new Set<string>();
  const apps: BottegaAppsPort = {
    list: () => (ports.apps()?.store.list() ?? []).filter((record) => !["deleting", "quarantined"].includes(record.state))
      .map((record) => ({ id: record.id, label: appDisplayName(record), appIcon: record.manifest?.icon ?? null, ready: record.enabled && record.state === "ready" })),
    fact: (appId) => {
      const record = appId ? ports.apps()?.store.get(appId) : undefined;
      const label = record ? appDisplayName(record) : "";
      if (!record || record.state === "deleting") return { label, state: "missing", running: false };
      return { label, appIcon: record.manifest?.icon ?? null, state: record.enabled && record.state === "ready" ? "ready" : "unavailable",
        running: Boolean(windowRegistry.app(record.id)) };
    },
    open: async (appId) => {
      const fact = apps.fact(appId);
      if (fact.state !== "ready") return;
      try { await surfaceWindowController.openAppWindow(appId); }
      catch (cause) {
        console.warn("[system-dock] App window failed", cause);
        if (errors.has(appId)) return;
        errors.add(appId);
        try {
          await dialog.showMessageBox({ type: "error", message: translate(ports.locale(), "apps.dock.openFailed", { name: fact.label }),
            detail: translate(ports.locale(), "apps.dock.openFailedDetail") });
        } finally { errors.delete(appId); }
      }
    },
  };
  return { apps, subscribe(changed: () => void) {
    const stopApps = ports.apps()?.store.watch(changed);
    const stopWindows = windowRegistry.subscribe((event) => { if (event.record.role === "app-window") changed(); });
    return () => { stopApps?.(); stopWindows(); };
  } };
}
