/**
 * [INPUT]: Depends on the onboardingEn structural type
 * [OUTPUT]: Includes Memory plugin enable, paused/resume and unsupported states; Provides onboardingEs, the Spanish Onboarding catalog
 * [POS]: Spanish leaf of shared/i18n/locales/onboarding; loaded on demand by the matching top-level locale
 */

import type { onboardingEn } from "./en";

export const onboardingEs: typeof onboardingEn = {
  optional: "Opcional",
  heading: { "chat-home": "¿Dónde debe guardar {{product}} tus archivos?", agent: "Configura tus Agents", extras: "Saca más partido a {{product}}" },
  description: {
    "chat-home": "Los chats, archivos y Skills viven en una carpeta tuya. En ambos casos, los ajustes de cuenta, las claves y los permisos del dispositivo permanecen en este ordenador.",
    agent: "{{product}} trabaja a través de los Agents de programación de este ordenador. Instala al menos uno para continuar; puedes añadir los demás cuando quieras desde Settings › Providers.",
    extras: "Todo es opcional. Omite lo que quieras ahora y actívalo después en Settings.",
  },
  back: "Atrás", next: "Continuar", start: "Empezar",
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
  extras: { skills: "Skills", memory: "Plugin Memory" },
  skillsAbout: "Importa las Skills que ya tienen tus Agents para que todas las conversaciones puedan usarlas.",
  skillsFound: "{{count}} encontradas", skillsImported: "Importadas", skillsImport: "Importar todo",
  skillsScanning: "Buscando Skills existentes…", skillsNone: "Todavía no hay Skills para importar", skillsDone: "Tu Skills Library personal está lista",
  skillsScanFailed: "No se pudieron buscar Skills. Reinténtalo o añádelas más tarde en Settings.",
  skillsImportTitle: "Se encontraron {{count}} Skills en tus Agents existentes",
  skillsImportDescription: "Impórtalos para usarlos en todas las conversaciones compatibles.",
  skillsImportAll: "Importar todo y activar", skillsSkip: "Omitir", skillsUpdateFailed: "No se pudo actualizar la bienvenida de Skills",
  memory: {
    badge: { start: "Sin configurar", installing: "Instalando", failed: "Sin terminar", connect: "Instalada", ready: "Lista", on: "Activada", paused: "En pausa", unsupported: "No compatible" },
    about: "Recuerda lo importante de tus conversaciones anteriores. Ejecuta un pequeño servicio en este ordenador.",
    installing: "Instalando {{provider}}: sigue en segundo plano. Puedes terminar la configuración más tarde.",
    failed: "La instalación de {{provider}} no terminó.",
    connect: "{{provider}} {{version}} está instalado. Conecta un modelo para empezar a recordar.",
    ready: "{{provider}} está listo. Actívalo para empezar a recordar y extraer.",
    on: "Abre los ajustes del plugin Memory para ver su actividad y los elementos pendientes.",
    paused: "Memory está en pausa. Los recuerdos guardados se conservan.", resume: "Reanudar",
    setUp: "Configurar…", retry: "Reintentar…", connectAction: "Conectar…", progress: "Ver progreso", turnOn: "Activar el plugin Memory",
  },
};
