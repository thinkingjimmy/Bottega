/**
 * [INPUT]: Depends on the shared Bottega Dock copy key set.
 * [OUTPUT]: Provides en Bottega Dock copy: bar and item names, panel views (Downloads, Trash, AI limits, AI usage, add, edit, keyboard list), Settings → Dock, sync choices, pause reasons, and the native menu and App-picker dialog strings main reads.
 * [POS]: system-dock locale slice mounted as `systemDock` by the English root catalog; the key-set reference for the four translations.
 */

export const systemDockEn = {
  presence: {
    retentionOffTitle: "Turn off background activity?",
    retentionOffBody: "Bottega Dock is on. Without background activity, closing the last Bottega window quits Bottega, which closes Bottega Dock and brings back the system Dock.",
    retentionOffConfirm: "Turn Off",
  },
  settings: { title: "Dock" },
};
