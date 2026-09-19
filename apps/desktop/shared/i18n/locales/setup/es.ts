/**
 * [INPUT]: Depends on the setupEn structural type
 * [OUTPUT]: Provides setupEs, the Spanish Setup catalog
 * [POS]: Spanish leaf of shared/i18n/locales/setup; loaded on demand by the matching top-level locale
 */

import type { setupEn } from "./en";

export const setupEs: typeof setupEn = {
  configure: "Configurar",
  provider: {
    mainWindowOnly: "Gestiona el entorno del Agent en la ventana principal.",
  },
  install: "Instalar", login: "Iniciar sesión", manageLogin: "Gestionar inicio de sesión", update: "Actualización disponible",
  updateAria: "Actualizar {{backend}}", recheck: "Volver a comprobar {{backend}}",
  checkAgain: "Volver a comprobar",
  updateNow: "Actualizar",
  reinstall: "Reinstalar",
  more: "Más acciones para {{backend}}",
  completed: "He terminado, comprobar",
  checkedAt: "Última comprobación: {{time}}",
  state: {
    installed: "Instalado, puedes probarlo",
    previouslyReady: "Listo en la última revisión",
    checkFailed: "Comprobación incompleta",
    waiting: "Esperando a la terminal",
    updateRequired: "Actualización necesaria",
    signInRequired: "Inicio de sesión necesario",
  },
  verification: {
    unverified: "El inicio de sesión se confirmará en tu primera conversación.",
    expired: "Se muestra el último resultado correcto.",
    failed: "La comprobación no pudo terminar. Se conserva el resultado anterior. Inténtalo de nuevo.",
    updateRequired: "Versión instalada: {{version}}. Se requiere {{minimum}} o posterior.",
    signInRequired: "Inicia sesión para usar este Agent.",
    cannotCheck: "No se pudo comprobar la instalación. Inténtalo de nuevo para confirmar su estado.",
    cannotStart: "Este Agent no pudo iniciarse. Vuelve a comprobarlo o reinstálalo desde el menú de más acciones.",
    waiting: "Termina la operación en la terminal y vuelve aquí para una comprobación automática.",
  },
  feedback: {
    load: "No se pudo cargar el estado de los Agents",
    check: "No se pudo completar la comprobación",
    install: "No se pudo abrir la instalación",
    update: "No se pudo abrir la actualización",
    login: "No se pudo abrir el inicio de sesión",
    clipboard: "Comando copiado",
    clipboardFailed: "No se pudo copiar el comando",
    pasteCommand: "Pega y ejecuta el comando en tu terminal. Vuelve a comprobarlo cuando termines.",
    retryHint: "Inténtalo de nuevo. Se conserva el estado anterior del Agent.",
  },
  checkIssue: {
    timeout: "La comprobación agotó el tiempo de espera. Inténtalo de nuevo más tarde.",
    connection: "No se pudo conectar con el servicio. Revisa tu conexión e inténtalo de nuevo.",
    busy: "El Agent está ocupado. Inténtalo de nuevo cuando termine la operación actual.",
    failed: "La comprobación no pudo terminar. Consulta los detalles e inténtalo de nuevo.",
  },
  guide: {
    claude: { install: "Instala primero Claude Code.", login: "Ejecuta `claude auth login` en una terminal." },
    codex: { install: "Instala primero la CLI de Codex.", login: "Ejecuta `codex login` en una terminal." },
    kimi: { install: "Instala primero Kimi Code.", login: "Ejecuta `kimi login` en una terminal." },
    opencode: { install: "Instala primero OpenCode.", login: "Ejecuta `opencode auth login` en una terminal." },
  },
};
