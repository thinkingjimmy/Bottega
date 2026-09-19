/**
 * [INPUT]: Depends on Electron app/dialog/power events, localized copy, restart intent, and the shared safe-quit coordinator, and the build-gated cloud account lifecycle.
 * [OUTPUT]: Provides application activation, login source, update visibility restoration, a one-time background notice and bounded system shutdown.
 * [POS]: Desktop presence lifecycle wiring extracted from the root composition.
 */

import { join } from "node:path";
import { RestartPresentation } from "./restart-presentation";
import { backgroundNotice } from "./background-notice";
import { app, dialog, powerMonitor } from "electron";
import { translate } from "../../../../shared/i18n/runtime";
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import type { SafeQuitCoordinator } from "../../startup/safe-quit";
import type { StopOperation } from "./start-fence";
import { windowRegistry } from "../../window/surfaces/window-registry";
import { createLoginItem } from "../platform/macos";
import { WindowRetention } from "./window-retention";
import { QuitRequests } from "./quit-requests";

export function createApplicationPresence(ports: { safeQuit(): SafeQuitCoordinator; locale(): AppLocale;
  enabled(): boolean; snapshot(): readonly StopOperation[]; refresh(): void; changed(): void; onProtocolArgs?(argv: string[]): void }) {
  const presentation = new RestartPresentation(join(app.getPath("userData"), "presence-restart.json"));
  let systemEnding = false;
  const loginItem = createLoginItem();
  let openedAtLogin = false;
  try { openedAtLogin = loginItem.read().wasOpenedAtLogin; } catch { /* Failed facts keep the main window visible. */ }
  const retention = new WindowRetention({ windows: windowRegistry, enabled: ports.enabled,
    quitting: () => ports.safeQuit().requested || ports.safeQuit().finished || systemEnding,
    finished: () => ports.safeQuit().finished,
    retained: () => { void backgroundNotice(app.getPath("userData"), ports.locale()).catch(() => {}); },
    recovered: () => { void dialog.showMessageBox({ type: "info", title: translate(ports.locale(), "settings.presence.open"), message: translate(ports.locale(), "settings.presence.recovered") }); },
    requestQuit: () => { void requestQuit(); } });
  const requests = new QuitRequests({ safeQuit: { prepare: (reason, permit) => ports.safeQuit().prepare(reason, permit) },
    snapshot: ports.snapshot, restoreWindow: () => retention.open(), changed: ports.changed,
    confirm: async (tasks, reason) => {
      const t = (key: string) => translate(ports.locale(), `settings.presence.${key}`, { tasks });
      const result = await dialog.showMessageBox({ type: "question", title: t(reason === "update" ? "restartTitle" : "quitTitle"), message: t("quitDescription"),
        buttons: [reason === "update" ? t("later") : translate(ports.locale(), "common.cancel"), t(reason === "update" ? "stopRestart" : "stopQuit")],
        defaultId: 0, cancelId: 0, noLink: true });
      return result.response === 1;
    } });
  const requestQuit = () => requests.request(systemEnding ? "system" : "quit").then((result) => {
    if (result === "ready") app.quit(); return result;
  });
  const activate = () => { retention.open(); ports.refresh(); };
  const secondInstance = (_event: unknown, _argv: string[], _cwd: string, data: unknown) => {
    ports.onProtocolArgs?.(_argv);
    if ((data as { launchSource?: string })?.launchSource !== "login") retention.open();
  };
  const allClosed = () => {
    // A renderer replacement may temporarily leave no native product windows.
    queueMicrotask(() => { if (!ports.safeQuit().finished && !ports.enabled() && !retention.recovering && !windowRegistry.list().length) void requestQuit(); });
  };
  const shutdown = ((event?: { preventDefault(): void }) => {
    systemEnding = true; event?.preventDefault();
    const timeout = setTimeout(() => app.exit(0), 8_000); timeout.unref();
    void ports.safeQuit().prepare("system").then((result) => { if (result === "ready") app.quit(); });
  }) as () => void;
  return { loginItem, openedAtLogin, retention, requests, requestQuit,
    consumeRestartPresentation: () => presentation.consume(app.getVersion()),
    async prepareUpdate(version: string | null, interactive = true) {
      if (!version) throw new Error("UPDATE_CANDIDATE_REQUIRED");
      await presentation.save(version, !(windowRegistry.main()?.window.isVisible?.() ?? true));
      try {
        const result = await requests.request("update", interactive);
        if (result !== "ready") await presentation.clear();
        return result;
      } catch (cause) { await presentation.clear(); throw cause; }
    },
    requestBeforeQuit: () => requests.request(systemEnding ? "system" : "quit"),
    bindActivation() { app.on("activate", activate); app.on("second-instance", secondInstance); app.on("window-all-closed", allClosed); },
    bindPower() { powerMonitor.on("resume", ports.refresh); powerMonitor.on("shutdown", shutdown); },
    close() { retention.close(); app.removeListener("activate", activate); app.removeListener("second-instance", secondInstance);
      app.removeListener("window-all-closed", allClosed); powerMonitor.removeListener("resume", ports.refresh); powerMonitor.removeListener("shutdown", shutdown); },
  };
}
