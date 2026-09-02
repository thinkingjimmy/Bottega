/**
 * [INPUT]: Depends on Electron file dialogs plus the shared locale and translation catalogs
 * [OUTPUT]: Provides localized Base import and export path selectors for BasesService composition
 * [POS]: The startup adapter that keeps native Base file-dialog policy out of the Electron composition root
 */

import type { Dialog, FileFilter } from "electron";
import type { AppLocale } from "../../../shared/i18n/locale";
import { translate } from "../../../shared/i18n/runtime";

const EXPORT_FILTER_KEYS = {
  csv: "settings.native.filterCsv",
  json: "settings.native.filterBaseJson",
  xlsx: "settings.native.filterExcelWorkbook",
} as const;

type ImportFormat = "json" | "xlsx";

function fileFilter(
  locale: AppLocale,
  format: keyof typeof EXPORT_FILTER_KEYS
): FileFilter {
  const extensions = [format];
  return { name: translate(locale, EXPORT_FILTER_KEYS[format]), extensions };
}

export function createBaseFileDialogs(
  nativeDialog: Pick<Dialog, "showOpenDialog" | "showSaveDialog">,
  currentLocale: () => AppLocale
) {
  return {
    chooseExportPath: async (
      suggestedName: string,
      format: keyof typeof EXPORT_FILTER_KEYS = "csv"
    ) => {
      const result = await nativeDialog.showSaveDialog({
        defaultPath: suggestedName,
        filters: [fileFilter(currentLocale(), format)],
      });
      return result.canceled ? null : result.filePath;
    },
    chooseImportPath: async (
      format: ImportFormat = "json"
    ) => {
      const result = await nativeDialog.showOpenDialog({
        properties: ["openFile"],
        filters: [fileFilter(currentLocale(), format)],
      });
      return result.canceled ? null : result.filePaths[0] ?? null;
    },
  };
}
