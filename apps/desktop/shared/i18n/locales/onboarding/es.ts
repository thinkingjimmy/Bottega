/**
 * [INPUT]: Depends on the onboardingEn structural type
 * [OUTPUT]: Provides onboardingEs, the Spanish two-step Onboarding and Chat Skills prompt catalog
 * [POS]: Spanish leaf of shared/i18n/locales/onboarding; loaded on demand by the matching top-level locale
 */

import type { onboardingEn } from "./en";

export const onboardingEs: typeof onboardingEn = {
  heading: { "chat-home": "¿Dónde debe guardar {{product}} tus archivos?", agent: "Configura tus Agents" },
  description: {
    "chat-home": "Los chats, archivos y Skills viven en una carpeta tuya. En ambos casos, los ajustes de cuenta, las claves y los permisos del dispositivo permanecen en este ordenador.",
    agent: "{{product}} trabaja a través de los Agents de programación de este ordenador. Instala al menos uno para continuar; puedes añadir los demás cuando quieras desde Settings › Providers.",
  },
  next: "Continuar", start: "Empezar",
  folder: {
    aria: "Dónde guardar tus archivos",
    fresh: "Empezar de cero", recommended: "Recomendado", freshDetail: "Crea {{path}} por ti.",
    found: "Seguir donde lo dejaste", foundBadge: "Encontrada", foundDetail: "{{path}} ya contiene tus chats y archivos de {{product}}.",
    choose: "Elegir una carpeta…", chooseDetail: "Nueva o existente: {{product}} lo detecta.",
  },
  opening: "Abriendo…",
  folderProgress: { opening: "Abriendo tus archivos… {{completed}} de {{total}}", saving: "Guardando tus archivos… {{completed}} de {{total}}" },
  agentLater: "Instalar más tarde",
  agentLaterFailed: "No se pudo guardar esta elección. Vuelve a intentarlo.",
  agentInstalled: "Instalado",
  agentChecking: "Comprobando…",
  agentInstalling: "Esperando la instalación…",
  agentCheckFailed: "No se pudo comprobar la instalación. Inténtalo de nuevo.",
  agentAbout: { codex: "El Agent de programación de OpenAI", claude: "El Agent de programación de Anthropic", kimi: "El Agent de programación de Moonshot", opencode: "Código abierto, con el modelo que prefieras" },
  skillsImportTitle: "Se encontraron {{count}} Skills en tus Agents existentes",
  skillsImportDescription: "Impórtalos para usarlos en todas las conversaciones compatibles.",
  skillsImportAll: "Importar todo y activar", skillsSkip: "Omitir", skillsUpdateFailed: "No se pudo actualizar la bienvenida de Skills",
};
