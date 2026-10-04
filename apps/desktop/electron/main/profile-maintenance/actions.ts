/**
 * [INPUT]: Depends on single-use maintenance intents, i18n, relocation planning and journal, folder admission, the erase request and injected settings/work/quit/login-item/Dock/restart ports.
 * [OUTPUT]: Provides createMaintenanceActions and its ports: plan and commit a folder move, inspect the folder an erase would retire and erase all data, each commit recording a request and restarting through safe quit (a refused quit withdraws the request); the folder goes to the Trash only when asked and admissible, and an erase is refused before anything is recorded while work runs, its confirmation expired or the system Dock could not be restored.
 * [POS]: Profile maintenance's owner, free of Electron; ipc.ts binds it to renderer IPC, the folder picker and the process restart.
 */
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import type { LibraryMovePlan } from "../../../shared/ipc/settings/settings-ipc";
import { translate } from "../../../shared/i18n/native";
import type { SafeQuitCoordinator } from "../startup/shutdown/safe-quit";
import { LibraryMoveError, planLibraryMove, type LibraryMoveErrorCode } from "../library/relocation/plan";
import { clearRelocation, writeRelocation } from "../library/relocation/journal";
import { assertAdmissibleLibraryRoot, holdsForeignEntries } from "../library/safety/admission";
import { MaintenanceIntents } from "./intents";
import { requestErase } from "./request";
import { ERASE_MARKER } from "./erase";

const MOVE_ERROR_KEYS: Record<LibraryMoveErrorCode, string> = {
  "same-place": "settings.native.libraryMove.samePlace",
  inside: "settings.native.libraryMove.inside",
  exists: "settings.native.libraryMove.exists",
  unwritable: "settings.native.libraryMove.unwritable",
  "project-overlap": "settings.native.libraryMove.projectOverlap",
  unsafe: "settings.native.library.unsafe-folder",
  busy: "settings.native.maintenanceBusy",
};

/** The document a confirmation was shown in; a commit from any other document is refused. */
export type MaintenanceContext = { windowId: string; rendererIncarnation: string };

export type ProfileMaintenancePorts = {
  userData: string;
  locale(): AppLocale;
  settings: { get(): { libraryRoot?: string | null; libraryId?: string | null } };
  /** Agent work still running; either action needs a quiet app to restart into. */
  busy(): boolean;
  projectDirs(): Iterable<string>;
  safeQuit(): SafeQuitCoordinator;
  disableLoginItem(): void;
  /** Gives the system Dock back and unregisters its recovery agent; false when the Dock could not be restored (the agent stays). */
  retireDock?(): Promise<boolean>;
};

export type MaintenanceActionPorts = ProfileMaintenancePorts & {
  /** Called once the quit is certain: the request runs on the next launch. */
  restart(): void;
};

export function createMaintenanceActions(ports: MaintenanceActionPorts) {
  const fail = (key: string): never => { throw new Error(translate(ports.locale(), key)); };
  const root = () => ports.settings.get().libraryRoot ?? fail("settings.native.libraryMoveMissing");
  const plan = async (parent: string) => {
    if (ports.busy()) throw new LibraryMoveError("busy");
    return planLibraryMove({ root: root(), parent, projectDirs: ports.projectDirs() });
  };
  const intents = new MaintenanceIntents();
  const consume = (kind: "move" | "erase", context: MaintenanceContext, token: unknown) => {
    try { return intents.verify(kind, context, token); }
    catch { return fail("settings.native.maintenanceConfirmationExpired"); }
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
    ports.restart();
  };

  return {
    root,
    /** The picked parent becomes a plan the person is shown; only its id comes back to commit. */
    planMove: (context: MaintenanceContext, parent: string) => localized(async (): Promise<LibraryMovePlan> => {
      const from = root(), to = await plan(parent);
      return { from, to, planId: intents.mint("move", context, to) };
    }),
    commitMove: (context: MaintenanceContext, planId: unknown) => localized(async () => {
      // Only the plan this document was shown, once: never a path the renderer names.
      const planned = consume("move", context, planId);
      // The plan is taken again: the disk, the folder and the running work may all have changed since.
      const to = await plan(dirname(planned));
      if (to !== planned) throw new Error("Invalid destination");
      await restartWith(
        () => writeRelocation(ports.userData, { kind: "move", from: root(), to, libraryId: ports.settings.get().libraryId ?? null }),
        () => clearRelocation(ports.userData), () => intents.spend(planId));
    }),
    /* Opening the Erase confirmation is what mints its token; the erase itself must present it. */
    inspectErase: async (context: MaintenanceContext) => {
      const folder = ports.settings.get().libraryRoot ?? null;
      return { foreignEntries: folder ? await holdsForeignEntries(folder) : false, token: intents.mint("erase", context, folder ?? "") };
    },
    eraseAll: async (context: MaintenanceContext, raw: unknown) => {
      const request = raw as { trashFolder?: unknown; token?: unknown } | null;
      const trashFolder = request?.trashFolder === true;
      // The folder the confirmation named; a folder that changed since is not what the person agreed to erase.
      const confirmed = consume("erase", context, request?.token);
      if (ports.busy()) fail("settings.native.maintenanceBusy");
      /* Only a folder that could be the Bottega folder today may go to the Trash whole; one configured
         before admission existed (the home folder) is left where it is. */
      const folder = ports.settings.get().libraryRoot ?? null;
      if ((folder ?? "") !== confirmed) fail("settings.native.maintenanceConfirmationExpired");
      const retire = trashFolder && folder && await assertAdmissibleLibraryRoot(folder).then(() => true, () => false) ? folder : null;
      /* The system Dock comes back before anything is erased, and only then does its recovery agent go (F-42). Its journal
         lives in this profile, so erasing past a failed restore would leave nobody able to bring the Dock back. */
      if (ports.retireDock && !await ports.retireDock()) fail("settings.native.eraseDockRestoreFailed");
      await restartWith(
        () => requestErase(ports.userData, retire),
        () => rm(join(ports.userData, ERASE_MARKER), { force: true }),
        // The erased profile no longer asked to start at login; the system must stop doing so too.
        () => { intents.spend(request?.token); try { ports.disableLoginItem(); } catch (cause) { console.warn("[erase] login item not cleared", cause); } });
    },
  };
}
