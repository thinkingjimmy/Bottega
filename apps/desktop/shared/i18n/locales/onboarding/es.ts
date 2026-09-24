/**
 * [INPUT]: Depends on the onboardingEn structural type
 * [OUTPUT]: Provides onboardingEs, the Spanish Onboarding catalog
 * [POS]: Spanish leaf of shared/i18n/locales/onboarding; loaded on demand by the matching top-level locale
 */

import type { onboardingEn } from "./en";

export const onboardingEs: typeof onboardingEn = {
  rail: {
    steps: "Pasos de configuración",
    intro: "Tres pasos rápidos. Todo esto se puede cambiar después en Settings.",
    footer: "{{product}} funciona en local. Nada sale de este ordenador salvo que tú lo pidas.",
    done: "Completado",
  },
  step: {
    "chat-home": { label: "Ubicación", hint: "Dónde viven tus chats y archivos" },
    agent: { label: "Agents", hint: "Al menos uno para empezar a chatear" },
    extras: { label: "Más", hint: "Skills y memoria — opcional" },
  },
  heading: { "chat-home": "¿Dónde debe guardar {{product}} tus archivos?", agent: "Configura tus Agents", extras: "Saca más partido a {{product}}" },
  description: {
    "chat-home": "Elige una carpeta vacía para empezar de cero o una carpeta de {{product}} existente para seguir donde lo dejaste. En ambos casos, los ajustes de cuenta, las claves y los permisos del dispositivo permanecen en este ordenador.",
    agent: "{{product}} trabaja a través de los Agents de programación de este ordenador. Instala al menos uno para continuar; puedes añadir los demás cuando quieras desde Settings › Providers.",
    extras: "Todo es opcional. Omite lo que quieras ahora y actívalo después en Settings.",
  },
  back: "Atrás", next: "Continuar", start: "Empezar",
  folder: "Carpeta de {{product}}",
  chatHome: { unconfigured: "Sin elegir", ready: "Lista" },
  chatHomeUnset: "Elige una carpeta en este ordenador.", choose: "Elegir…", opening: "Abriendo…",
  folderProgress: { opening: "Abriendo tus archivos… {{completed}} de {{total}}", saving: "Guardando tus archivos… {{completed}} de {{total}}" },
  agentLater: "Instalar más tarde",
  agentLaterFailed: "No se pudo guardar esta elección. Vuelve a intentarlo.",
  agentInstalled: "Instalado",
  agentChecking: "Comprobando…",
  agentInstalling: "Esperando la instalación…",
  agentCheckFailed: "No se pudo comprobar la instalación. Inténtalo de nuevo.",
  agentAbout: { codex: "El Agent de programación de OpenAI", claude: "El Agent de programación de Anthropic", kimi: "El Agent de programación de Moonshot", opencode: "Código abierto, con el modelo que prefieras" },
  extras: { skills: "Skills", memory: "Memoria a largo plazo" },
  skillsAbout: "Importa las Skills que ya tienen tus Agents para que todas las conversaciones puedan usarlas.",
  skillsFound: "{{count}} encontradas", skillsImported: "Importadas", skillsImport: "Importar todo",
  skillsScanning: "Buscando Skills existentes…", skillsNone: "Todavía no hay Skills para importar", skillsDone: "Tu Skills Library personal está lista",
  skillsScanFailed: "No se pudieron buscar Skills. Reinténtalo o añádelas más tarde en Settings.",
  skillsImportTitle: "Se encontraron {{count}} Skills en tus Agents existentes",
  skillsImportDescription: "Impórtalos para usarlos en todas las conversaciones compatibles.",
  skillsImportAll: "Importar todo y activar", skillsSkip: "Omitir", skillsUpdateFailed: "No se pudo actualizar la bienvenida de Skills",
  memory: {
    badge: { start: "Sin configurar", installing: "Instalando", failed: "Sin terminar", connect: "Instalada", ready: "Lista", on: "Activada" },
    about: "Recuerda lo importante de tus conversaciones anteriores. Ejecuta un pequeño servicio en este ordenador.",
    installing: "Instalando {{provider}}: sigue en segundo plano. Puedes terminar la configuración más tarde.",
    failed: "La instalación de {{provider}} no terminó.",
    connect: "{{provider}} {{version}} está instalado. Conecta un modelo para empezar a recordar.",
    ready: "{{provider}} está listo. Actívalo para empezar a recordar y extraer.",
    on: "Settings › Memory muestra su actividad y sus huecos.",
    setUp: "Configurar…", retry: "Reintentar…", connectAction: "Conectar…", progress: "Ver progreso", turnOn: "Activar",
  },
};
