/**
 * [INPUT]: Depends on the English Bottega Dock key set.
 * [OUTPUT]: Provides fr Bottega Dock copy using macOS's French names (Dock, Finder, Téléchargements, Corbeille, Réglages Système).
 * [POS]: system-dock locale slice mounted as `systemDock` by the French root catalog.
 */
import type { systemDockEn } from "./en";

export const systemDockFr: typeof systemDockEn = {
  presence: {
    retentionOffTitle: "Désactiver l’activité en arrière-plan ?",
    retentionOffBody: "Bottega Dock est activé. Sans activité en arrière-plan, fermer la dernière fenêtre de Bottega quitte Bottega, ce qui ferme Bottega Dock et rétablit le Dock système.",
    retentionOffConfirm: "Désactiver",
  },
  settings: { title: "Dock" },
};
