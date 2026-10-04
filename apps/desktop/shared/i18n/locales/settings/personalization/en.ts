/**
 * [INPUT]: No runtime dependencies
 * [OUTPUT]: Provides settingsPersonalizationEn — Settings › Personalization editor placeholder text, find-in-file, size/line-count metrics, and recommended-limit copy — and the structural shape its translated leaves derive from
 * [POS]: English leaf of shared/i18n/locales/settings/personalization; the global Agent instruction-file catalog; the KiB unit symbol is left untranslated
 */

export const settingsPersonalizationEn = {
  title: "Personalization",
  sectionTitle: "Custom instructions",
  description: "Edit the global instruction file used by each installed Agent.",
  loading: "Loading instruction files…",
  emptyTitle: "No Agent is installed",
  emptyHint: "Install an Agent in Backends settings, then return here.",
  placeholder: "Write plain-text instructions for this Agent…",
  createHint: "This file does not exist yet. Saving creates it at {{path}}.",
  save: "Save instructions",
  saving: "Saving…",
  copyPath: "Copy path",
  copied: "Path copied",
  reveal: "Show in file manager",
  oversized: "This file is larger than 256 KiB. It is not loaded or editable here.",
  find: {
    open: "Find in file",
    placeholder: "Find in file",
    count: "{{current}} / {{total}}",
    noMatches: "No matches",
    previous: "Previous match",
    next: "Next match",
    close: "Close find",
  },
  metrics: {
    lines: "{{lines}} lines",
    limit: "{{size}} limit",
    recommendedLines: "{{lines}} lines recommended",
    recommendedSize: "{{size}} recommended",
  },
  errors: {
    bridge: "Personalization is unavailable in this app build.",
    conflict: "The file changed outside the app. Your unsaved edits are kept; saving again will overwrite the newer disk version.",
    tooLarge: "Instructions cannot exceed 256 KiB.",
    oversizedFile: "The file is larger than 256 KiB and cannot be edited here.",
    symlinkUnresolvable: "The symbolic link is broken or cyclic. Repair it before saving.",
    readFailed: "The instruction file could not be read safely.",
    writeFailed: "The instruction file could not be saved.",
  },
};
