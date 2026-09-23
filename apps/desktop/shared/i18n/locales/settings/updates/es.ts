/**
 * [INPUT]: Depends on the settingsUpdatesEn structural type
 * [OUTPUT]: Provides settingsUpdatesEs, the Spanish Settings › Updates catalog
 * [POS]: Spanish leaf of shared/i18n/locales/settings/updates; loaded on demand by the matching top-level locale
 */

import type { settingsUpdatesEn } from "./en";

export const settingsUpdatesEs: typeof settingsUpdatesEn = {
  title: "Actualizaciones",
  description: "Gestiona las actualizaciones de Bottega y de los CLI de los proveedores.",
  updateAll: "Actualizar todo",
  updateOne: "Actualizar {{name}}",
  upToDate: "{{name}} está actualizado",
  updating: "Actualizando {{name}}…",
  latestUnknown: "Última versión desconocida",
  cliFailed: "La actualización falló",
  cliUnchanged: "El actualizador terminó, pero la versión no cambió. Prueba a actualizar en Terminal.",
  cliTimeout: "La actualización tardó demasiado y se detuvo.",
  cliUnavailable: "Este CLI no se puede actualizar desde aquí.",
  retry: "Reintentar",
  log: "Registro",
  terminal: "Actualizar en Terminal",
  empty: "Aún no hay ningún CLI de proveedor instalado.",
  checking: "Buscando actualizaciones…",
  current: "Actualizado{{checkedAt}}",
  available: "La versión {{version}} está disponible",
  downloading: "Descargando {{version}}",
  installing: "Actualización descargada · reiniciando para instalarla",
  failed: "Error de actualización: {{message}}",
  failedUnknown: "La actualización falló por un motivo desconocido.",
  failedFallback:
    "La actualización no pudo instalarse automáticamente. Abre la página de Releases para descargar la versión {{version}}.",
  failedResolution:
    "Descarga la nueva versión desde la página de Releases, o informa del problema en GitHub.",
  backgroundFailed: "La última comprobación automática falló",
  backgroundFailedOpen: "Las comprobaciones automáticas fallan; abre Actualizaciones para ver los detalles",
  check: "Buscar actualizaciones",
  upgrade: "Actualizar ahora",
  manualUpgrade: "Abrir página de descarga",
  unavailable: "El servicio de actualización está disponible en la aplicación instalada",
  platformSupport: "Compatibilidad de plataforma",
  preview: "Vista previa de {{platform}}",
  previewDescription:
    "El empaquetado, el inicio y las actualizaciones son compatibles. Estas capacidades permanecen desactivadas hasta completar los contratos de custodia y aislamiento del sistema:",
  features: {
    agentTurns: "conversaciones con Agents",
    headlessSandbox: "tareas Agent sin interfaz",
    ownedGitMutation: "cambios Git administrados",
    serverApps: "Apps de servidor",
    chromeImport: "importación de sesión de Chrome",
    memory: "Memory administrada",
  },
};
