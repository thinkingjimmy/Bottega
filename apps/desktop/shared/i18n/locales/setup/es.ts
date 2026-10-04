/**
 * [INPUT]: Depends on the setupEn structural type
 * [OUTPUT]: Provides setupEs, the Spanish Setup catalog
 * [POS]: Spanish leaf of shared/i18n/locales/setup; loaded on demand by the matching top-level locale
 */

import type { setupEn } from "./en";

export const setupEs: typeof setupEn = {
  provider: {
    mainWindowOnly: "Gestiona el entorno del Agent en la ventana principal.",
  },
  install: "Instalar", login: "Iniciar sesión",
  checkAgain: "Volver a comprobar",
  completed: "He terminado, comprobar",
  state: {
    installed: "Instalado, puedes probarlo",
    previouslyReady: "Listo en la última revisión",
    checkFailed: "Comprobación incompleta",
    waiting: "Esperando a la terminal",
    updateRequired: "Actualización necesaria",
    signInRequired: "Inicio de sesión necesario",
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
  guide: {
    claude: { install: "Instala primero Claude Code.", login: "Ejecuta `claude auth login` en una terminal." },
    codex: { install: "Instala primero la CLI de Codex.", login: "Ejecuta `codex login` en una terminal." },
    kimi: { install: "Instala primero Kimi Code.", login: "Ejecuta `kimi login` en una terminal." },
    opencode: { install: "Instala primero OpenCode.", login: "Ejecuta `opencode auth login` en una terminal." },
  },
};
