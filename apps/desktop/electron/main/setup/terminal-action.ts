/**
 * [INPUT]: Depends on Electron confirmation/clipboard, fixed commands, safe diagnostics and an optional pre-launch reservation.
 * [OUTPUT]: Confirms before reserving, launches fixed Terminal commands and reports cancelled, clipboard or clipboard-failed delivery.
 * [POS]: Setup delivery boundary; renderer callers cannot submit shell commands or credentials.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { clipboard, dialog, type BrowserWindow } from "electron";
import type { SetupTerminalResult } from "../../../shared/setup-ipc";
import { diagnosticFailureDetails } from "../../../shared/product-failure";
import type { SetupCommand } from "../backends/types";
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import { translate } from "../../../shared/i18n/runtime";

const execFileAsync = promisify(execFile);

export function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function appleScriptQuote(value: string) {
  return JSON.stringify(value);
}

export async function launchSetupTerminalAction(
  window: BrowserWindow | null,
  action: SetupCommand,
  dependencies: {
    platform?: NodeJS.Platform;
    confirm?: (command: string) => Promise<boolean>;
    execute?: (script: string) => Promise<void>;
    copy?: (command: string) => void;
    beforeLaunch?: () => Promise<void>;
    locale?: () => AppLocale;
  } = {}
): Promise<SetupTerminalResult> {
  const confirm =
    dependencies.confirm ??
    (async (command) => {
      if (!window || window.isDestroyed()) return false;
      const locale = dependencies.locale?.() ?? "en";
      const result = await dialog.showMessageBox(window, {
        type: "warning",
        title: translate(locale, "settings.native.terminalTitle"),
        message: translate(locale, "settings.native.terminalMessage"),
        detail: command,
        buttons: [
          translate(locale, "common.cancel"),
          translate(locale, "common.continue"),
        ],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      return result.response === 1;
    });
  if (action.dangerous && !(await confirm(action.command))) {
    return { launched: false, delivery: "cancelled" };
  }
  const copy = dependencies.copy ?? ((value) => clipboard.writeText(value));
  const copyCommand = (): SetupTerminalResult => {
    try { copy(action.command); return { launched: false, delivery: "clipboard" }; }
    catch (cause) {
      const details = diagnosticFailureDetails(cause);
      return { launched: false, delivery: "clipboard-failed", diagnostic: details.kind === "diagnostic" ? details.message : undefined };
    }
  };
  if ((dependencies.platform ?? process.platform) !== "darwin") {
    return copyCommand();
  }
  await dependencies.beforeLaunch?.();
  const command = `/bin/zsh -lc ${shellQuote(action.command)}`;
  const script =
    `tell application "Terminal" to do script ${appleScriptQuote(command)}\ntell application "Terminal" to activate`;
  try {
    await (
      dependencies.execute ??
      (async (source) => {
        await execFileAsync("/usr/bin/osascript", ["-e", source], {
          timeout: 10_000,
        });
      })
    )(script);
    return { launched: true, delivery: "terminal" };
  } catch {
    return copyCommand();
  }
}
