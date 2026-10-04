/**
 * [INPUT]: Depends on the settingsBrowserEn structural type
 * [OUTPUT]: Provides settingsBrowserEs, the Spanish Settings › Browser catalog
 * [POS]: Spanish leaf of shared/i18n/locales/settings/browser; loaded on demand by the matching top-level locale
 */

import type { settingsBrowserEn } from "./en";

export const settingsBrowserEs: typeof settingsBrowserEn = {
  sectionTitle: "Importar la sesión desde Chrome",
  loginState: "Sesión de Chrome",
  detecting: "Detectando Chrome…",
  detectingAria: "Detectando Chrome",
  readyDescription:
    "Elige un perfil y los dominios antes de importar. Los datos de Chrome son de solo lectura y no se modificarán.",
  noProfiles: "No se encontró Google Chrome ni un perfil utilizable.",
  detectFailed: "No se pudieron detectar los perfiles de Chrome.",
  platformUnavailable: "La importación de sesión de Chrome no está disponible en esta versión preliminar.",
  startImport: "Iniciar importación",
  startImportAria: "Iniciar la importación de la sesión de Chrome",
  learnMore: "Más información",
  capability: {
    persistentTitle: "Inicia sesión una vez y consérvala",
    persistentDetail:
      "Aunque omitas la importación, puedes iniciar sesión en el Browser integrado. Las Cookies persisten entre pestañas y reinicios, y el Agent usa la misma sesión.",
    limitedTitle: "No se importan contraseñas, extensiones ni marcadores",
    limitedDetail:
      "Electron no ofrece el gestor de contraseñas ni todas las API de extensiones de Chrome, y los marcadores no intervienen en la navegación del Agent. Así se evita mover datos sensibles sin utilidad.",
  },
  result: "Importadas {{imported}} / omitidas {{skipped}} / fallidas {{failed}}",
  resultFallback:
    "Algunos sitios no se pudieron importar. Inicia sesión una vez en Browser para conservarla y compartirla con el Agent.",
  dialogTitle: "Importar la sesión desde Chrome",
  dialogDescription:
    "Elige un perfil y los dominios que quieres importar. Todos están seleccionados de forma predeterminada y puedes desmarcarlos. Los datos de Chrome no se modificarán.",
  profile: "Perfil de Chrome",
  cookieDomains: "Dominios de Cookies",
  selectedDomains: "{{domains}} dominios seleccionados, unas {{cookies}} Cookies persistentes",
  selectAll: "Seleccionar todo",
  deselectAll: "Deseleccionar todo",
  loadingDomains: "Leyendo dominios…",
  previewUnknown: "Error desconocido",
  previewFailed: "No se pudieron leer los dominios Cookie de este perfil.",
  previewFailureTruth:
    "No se pudieron leer las Cookies de este perfil; eso no significa que no tenga una sesión iniciada.",
  noCookies: "Este perfil no tiene Cookies persistentes disponibles para importar.",
  keychainNotice:
    "Al continuar, macOS pedirá acceso a «Chrome Safe Storage». El descifrado y la importación ocurren solo en este Mac; las Cookies no se suben. Denegar el acceso no afecta a Chrome.",
  importAction: "Importar sesión",
  importFailed:
    "No se pudo importar la sesión. Aún puedes iniciar sesión una vez en Browser y conservarla.",
};
