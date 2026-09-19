/**
 * [INPUT]: Depends on the onboardingEn structural type
 * [OUTPUT]: Provides onboardingEs, the Spanish Onboarding catalog
 * [POS]: Spanish leaf of shared/i18n/locales/onboarding; loaded on demand by the matching top-level locale
 */

import type { onboardingEn } from "./en";

export const onboardingEs: typeof onboardingEn = {
  mode: {"local": {"title": "Usar en este ordenador", "description": "Todo permanece en este ordenador. Podrás iniciar sesión y sincronizar más tarde en Ajustes."}, "account": {"title": "Conectar una cuenta existente", "description": "Inicia sesión para unirte a tu espacio de sincronización cifrado y sincronizar contenido entre dispositivos."}},
  accountUnavailable: "La conexión a la cuenta no está disponible temporalmente.",
  agentPlace: {"local": "Instalar en este ordenador", "remote": "Usar otro ordenador"},
  remoteEmpty: "Primero inicia sesión e instala un Agent en otro ordenador.",
  folderProgress: {"opening": "Abriendo tus archivos… {{completed}} de {{total}}", "saving": "Guardando tus archivos… {{completed}} de {{total}}"} ,
  agentInstalled: "Instalado",
  agentChecking: "Comprobando…",
  agentInstalling: "Esperando la instalación…",
  agentCheckFailed: "No se pudo comprobar la instalación. Inténtalo de nuevo.",
  step: { mode: "Uso", account: "Conectar cuenta", "chat-home": "Ubicación", agent: "Agent", extras: "Más posibilidades" },
  heading: { mode: "¿Cómo usarás {{product}}?", "chat-home": "¿Dónde debe guardar {{product}} tus archivos?", agent: "Configura tu Agent", extras: "Saca más partido a {{product}}" },
  back: "Atrás", next: "Continuar", start: "Empezar",
  description: { mode: "Elige cómo empezar.", "chat-home": "Elige una carpeta de Bottega existente para restaurar su contenido o una carpeta vacía para empezar. Los ajustes de cuenta, las claves y los permisos permanecen en este ordenador.", agent: "Instala al menos un Agent para continuar.", extras: "Importa Skills reutilizables y configura la memoria a largo plazo. Ambas opciones son opcionales y pueden cambiarse después en Settings." },
  extras: { skills: "Skills", memory: "Memoria a largo plazo" },
  skillsScanFailed: "No se pudieron buscar Skills. Reinténtalo o añádelas más tarde en Settings.",
  skillsImportTitle: "Se encontraron {{count}} Skills en tus Agents existentes",
  skillsImportDescription: "Impórtalos para usarlos en todas las conversaciones compatibles.",
  skillsScanning: "Buscando Skills existentes…", skillsFound: "Se encontraron {{count}} Skills en tus Agents existentes · Impórtalos para usarlos en todas las conversaciones compatibles", skillsNone: "Todavía no hay Skills para importar", skillsDone: "Tu Skills Library personal está lista", skillsImportAll: "Importar todo y activar", skillsSkip: "Omitir", skillsUpdateFailed: "No se pudo actualizar la bienvenida de Skills",
  chatHome: { unconfigured: "Elige una carpeta en este ordenador.", ready: "Tu carpeta de Bottega está lista." },
  chatHomeUnset: "Sin elegir", choose: "Elegir carpeta…", opening: "Abriendo…",
  memoryEnabled: "Settings › Memory muestra su actividad y sus huecos.", memoryDisabled: "Instala el servicio de memoria local y confirma una vez la divulgación de privacidad; después empiezan el recuerdo y la extracción.",
  memoryAction: "Configurar memoria",
  memoryInstalling: "Instalando {{provider}}… continúa en segundo plano. Ya puedes empezar.", memoryInstallFailed: "La instalación de {{provider}} no terminó.",
  memoryConnect: "{{provider}} {{version}} está instalado. Conecta un modelo para terminar.", memoryReady: "{{provider}} está listo. Actívalo para empezar a recordar y extraer.",
  memoryProgress: "Ver progreso", memoryTurnOn: "Activar", memoryHide: "Ocultar",
};
