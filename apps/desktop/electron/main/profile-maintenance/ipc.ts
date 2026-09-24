/**
 * [INPUT]: Depends on Electron app/dialog, trusted renderer IPC, i18n, relocation planning and journal, the erase request and injected quit/work/settings ports.
 * [OUTPUT]: Provides createProfileMaintenance: the registrar for "move the Bottega folder" and "erase all data", both of which record a request and restart (development builds served by the renderer dev server only quit).
 * [POS]: Settings' only path to actions that must run before any store opens; the running app validates and records, the next launch performs.
 */
import { app, dialog, type BrowserWindow } from "electron";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import { SETTINGS_CHANNEL, type LibraryMovePlan } from "../../../shared/settings-ipc";
import { translate } from "../../../shared/i18n/runtime";
import { rendererIpc } from "../ipc-registrar";
import type { SafeQuitCoordinator } from "../startup/safe-quit";
import { LibraryMoveError, planLibraryMove, type LibraryMoveErrorCode } from "../library/relocation/plan";
import { clearRelocation, writeRelocation } from "../library/relocation/journal";
import { requestErase } from "./request";
import { ERASE_MARKER } from "./erase";

const MOVE_ERROR_KEYS: Record<LibraryMoveErrorCode, string> = {
  "same-place": "settings.native.libraryMove.samePlace",
  inside: "settings.native.libraryMove.inside",
  exists: "settings.native.libraryMove.exists",
  unwritable: "settings.native.libraryMove.unwritable",
  "project-overlap": "settings.native.libraryMove.projectOverlap",
  busy: "settings.native.maintenanceBusy",
};

export type ProfileMaintenancePorts = {
  userData: string;
  locale(): AppLocale;
  settings: { get(): { libraryRoot?: string | null; libraryId?: string | null } };
  /** Agent work still running; either action needs a quiet app to restart into. */
  busy(): boolean;
  projectDirs(): Iterable<string>;
  safeQuit(): SafeQuitCoordinator;
  disableLoginItem(): void;
};

export function createProfileMaintenance(ports: ProfileMaintenancePorts) {
  const fail = (key: string): never => { throw new Error(translate(ports.locale(), key)); };
  const root = () => ports.settings.get().libraryRoot ?? fail("settings.native.libraryMoveMissing");
  const plan = async (parent: string) => {
    if (ports.busy()) throw new LibraryMoveError("busy");
    return planLibraryMove({ root: root(), parent, projectDirs: ports.projectDirs() });
  };
  const localized = async <T>(run: () => Promise<T>) => {
    try { return await run(); }
    catch (cause) {
      if (cause instanceof LibraryMoveError) fail(MOVE_ERROR_KEYS[cause.code]);
      throw cause;
    }
  };

  /* The request is written first and withdrawn if the quit does not go through, so a refused
     quit never leaves a move or an erase waiting to surprise a later, unrelated launch. */
  const restartWith = async (record: () => Promise<void>, withdraw: () => Promise<unknown>, committed?: () => void) => {
    await record();
    const result = await ports.safeQuit().prepare("quit");
    if (result !== "ready") {
      if (!ports.safeQuit().finished) await withdraw();
      fail("settings.native.maintenanceBusy");
    }
    committed?.();
    /* Under `pnpm dev` the renderer server exits with this process, so a relaunch would open a window
       onto a dead URL. Quitting is enough there: the request runs on the next `pnpm dev`. */
    if (app.isPackaged || !process.env.ELECTRON_RENDERER_URL) app.relaunch();
    else console.info("[profile-maintenance] quitting without relaunch in development; run `pnpm dev` again to continue");
    app.quit();
  };

  return {
    register(window: BrowserWindow, rendererUrl: string) {
      rendererIpc(rendererUrl, "拒绝非驻留窗口的设置请求")
        .handle(SETTINGS_CHANNEL.planLibraryMove, () => localized(async (): Promise<LibraryMovePlan | null> => {
          const from = root();
          const picked = await dialog.showOpenDialog(window, {
            title: translate(ports.locale(), "settings.native.libraryMovePick"),
            buttonLabel: translate(ports.locale(), "settings.native.libraryMovePickButton"),
            defaultPath: dirname(from), properties: ["openDirectory", "createDirectory"],
          });
          const parent = picked.filePaths[0];
          if (picked.canceled || !parent) return null;
          return { from, to: await plan(parent) };
        }))
        .handle(SETTINGS_CHANNEL.commitLibraryMove, (raw) => localized(async () => {
          if (typeof raw !== "string" || !raw.startsWith("/")) throw new Error("Invalid destination");
          // The plan is taken again: the disk, the folder and the running work may all have changed since.
          const to = await plan(dirname(raw));
          if (to !== raw) throw new Error("Invalid destination");
          await restartWith(
            () => writeRelocation(ports.userData, { kind: "move", from: root(), to, libraryId: ports.settings.get().libraryId ?? null }),
            () => clearRelocation(ports.userData));
        }))
        .handle(SETTINGS_CHANNEL.eraseAllData, async (raw) => {
          const trashFolder = (raw as { trashFolder?: unknown } | null)?.trashFolder === true;
          if (ports.busy()) fail("settings.native.maintenanceBusy");
          await restartWith(
            () => requestErase(ports.userData, trashFolder ? ports.settings.get().libraryRoot ?? null : null),
            () => rm(join(ports.userData, ERASE_MARKER), { force: true }),
            // The erased profile no longer asked to start at login; the system must stop doing so too.
            () => { try { ports.disableLoginItem(); } catch (cause) { console.warn("[erase] login item not cleared", cause); } });
        });
    },
  };
}
