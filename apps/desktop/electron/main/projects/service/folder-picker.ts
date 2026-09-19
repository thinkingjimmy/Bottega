/**
 * [INPUT]: Depends on the Electron directory dialog, the main locale catalog and Project directory validation.
 * [OUTPUT]: Provides pickProjectDirectory, the single native folder chooser behind Project creation and binding.
 * [POS]: Projects service leaf; it canonicalizes and validates one selection but never touches ProjectFile state.
 */

import { realpath } from "node:fs/promises";
import { basename } from "node:path";
import { dialog, type BrowserWindow } from "electron";
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import { translate } from "../../../../shared/i18n/runtime";
import { isUsableDirectory } from "../fs-utils";

/** Resolves to null when the user dismisses the dialog; creation and binding must treat that as a no-op. */
export async function pickProjectDirectory(
  locale: AppLocale,
  parent: BrowserWindow | null
) {
  const options = {
    title: translate(locale, "settings.native.chooseProject"),
    properties: ["openDirectory", "createDirectory"] as Array<
      "openDirectory" | "createDirectory"
    >,
  };
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options);
  const selected = result.filePaths[0];
  if (result.canceled || !selected) return null;
  const canonicalRoot = await realpath(selected);
  if (!isUsableDirectory(canonicalRoot)) throw new Error("所选文件夹不可用");
  return { canonicalRoot, name: basename(canonicalRoot) || canonicalRoot };
}
