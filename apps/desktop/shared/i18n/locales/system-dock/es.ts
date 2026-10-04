/**
 * [INPUT]: Depends on the English Bottega Dock key set.
 * [OUTPUT]: Provides es Bottega Dock copy using macOS's Spanish names (Dock, Finder, Descargas, Papelera, Ajustes del Sistema).
 * [POS]: system-dock locale slice mounted as `systemDock` by the Spanish root catalog.
 */
import type { systemDockEn } from "./en";

export const systemDockEs: typeof systemDockEn = {
  presence: {
    retentionOffTitle: "¿Desactivar la actividad en segundo plano?",
    retentionOffBody: "Bottega Dock está activado. Sin actividad en segundo plano, al cerrar la última ventana de Bottega se sale de Bottega, lo que cierra Bottega Dock y restaura el Dock del sistema.",
    retentionOffConfirm: "Desactivar",
  },
  settings: { title: "Dock" },
};
