/**
 * [INPUT]: Depends on the settingsAboutEn structural type
 * [OUTPUT]: Provides settingsAboutEs, the Spanish Settings › About catalog
 * [POS]: Spanish leaf of shared/i18n/locales/settings/about; loaded on demand by the matching top-level locale
 */

import type { settingsAboutEn } from "./en";

export const settingsAboutEs: typeof settingsAboutEn = {
  title: "Acerca de",
  tagline: "El espacio de trabajo de Agents para macOS",
  version: "Versión {{version}}",
  licenseName: "Licencia MIT",
  readLicense: "Leer la licencia MIT",
  licenseUnavailable: "La licencia incluida no está disponible. Consulta la copia oficial en línea.",
  licenseCanonical: "Abrir la copia oficial",
  copy: "Copiar",
  copied: "Copiado",
  copyDiagnostics: "Copiar información de versión",
  links: "Enlaces",
  repository: "Repositorio del código fuente",
  feedback: "Informar de un problema",
  feedbackDescription: "Busca problemas conocidos o informa de uno nuevo",
  releaseNotes: "Notas de la versión",
  releaseNotesDescription: "Qué cambió en cada versión",
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
  backgroundFailedOpen:
    "Las comprobaciones automáticas de actualizaciones están fallando; abrir detalles",
  check: "Buscar actualizaciones",
  upgrade: "Actualizar ahora",
  manualUpgrade: "Abrir página de descarga",
  checkedAt: " · comprobado a las {{time}}",
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
