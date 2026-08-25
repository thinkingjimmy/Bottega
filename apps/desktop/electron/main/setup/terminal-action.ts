/**
 * [INPUT]: Depends on Electron dialog/clipboard, shared i18n, fixed descriptor SetupCommand and macOS osascript
 * [OUTPUT]: Provides launchSetupTerminalAction, AppleScript/shell quoting and downgrade to clipboard
 * [POS]: the terminal security boundaries of the setup; Renderer can never submit raw commands
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { clipboard, dialog, type BrowserWindow } from "electron";
import type { SetupCommand } from "../backends/types";
import type { AppLocale } from "../../../shared/i18n/locale";
import { translate } from "../../../shared/i18n/runtime";

const execFileAsync = promisify(execFile);

export function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function appleScriptQuote(value: string) {
  return JSON.stringify(value);
}

export type TerminalActionResult = {
  launched: boolean;
  delivery: "terminal" | "clipboard" | "cancelled";
};

export async function launchSetupTerminalAction(
  window: BrowserWindow | null,
  action: SetupCommand,
  dependencies: {
    platform?: NodeJS.Platform;
    confirm?: (command: string) => Promise<boolean>;
    execute?: (script: string) => Promise<void>;
    copy?: (command: string) => void;
    locale?: () => AppLocale;
  } = {}
): Promise<TerminalActionResult> {
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
  if ((dependencies.platform ?? process.platform) !== "darwin") {
    copy(action.command);
    return { launched: false, delivery: "clipboard" };
  }
  const command = `/bin/zsh -lc ${shellQuote(action.command)}`;
  const script =
    `tell application "Terminal" to do script ${appleScriptQuote(command)}`;
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
    copy(action.command);
    return { launched: false, delivery: "clipboard" };
  }
}
