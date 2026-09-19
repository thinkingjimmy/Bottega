/**
 * [INPUT]: Depends on the chatEn structural type
 * [OUTPUT]: Provides chatEs, the Spanish Chat catalog
 * [POS]: Spanish leaf of shared/i18n/locales/chat; loaded on demand by the matching top-level locale
 */

import type { chatEn } from "./en";

export const chatEs: typeof chatEn = {
  provider: {
    listFailed: "No se pudieron cargar los chats: {{message}}",
    renameFailed: "No se pudo renombrar el chat: {{message}}",
    sortFailed: "No se pudo mover el chat: {{message}}",
    archiveFailed: "No se pudo archivar el chat: {{message}}",
    deleteFailed: "No se pudo eliminar el chat: {{message}}",
  },
  sidebar: {
    priority: "Prioridad",
    nothingNeedsAttention: "No hay nada que requiera atención",
    waiting: "Esperando tu respuesta",
    running: "Generando",
    done: "Hay una respuesta nueva",
    failed: "La ejecución no se completó",
    archiveChat: "Archivar chat",
    moreActions: "Más acciones",
    archive: "Archivar",
    reorder: {
      pickedUp: "{{title}} levantado",
      moved: "{{title}} movido a la posición {{position}} de {{count}}",
      unchanged: "{{title}} conserva su posición",
      cancelled: "Reordenación cancelada",
    },
  },
  workspaceFiles: {
    bridgeUnavailable: "Los archivos del Workspace no están disponibles en este entorno.",
    searchFailed: "Falló la búsqueda de archivos del Workspace.",
  },
  interrupted: "Respuesta interrumpida. Se conservan los resultados parciales.",
  noText: "Este turno no devolvió texto.",
  relayStopConfirm: "¿Detener la solicitud actual y desconectar toda la cadena de relevo de Section?",
  workspaceImage: {
    unsupported: "La ruta seleccionada no es una imagen compatible.",
    admissionFailed: "No se pudo adjuntar la imagen.",
    readFailed: "No se pudo leer la imagen del Workspace.",
  },
  queue: {
    limit: "Solo se pueden poner en cola {{count}} mensajes.",
    chatBudget: "Los adjuntos en cola de este Chat superan 256 MiB.",
    enqueueFailed: "No se pudo poner el mensaje en cola.",
    globalBudget: "Los adjuntos en cola de todos los Chats superan 1 GiB.",
    frozenBudget: "Los adjuntos finalizados superan el límite de memoria de la cola.",
    workspaceChanged: "El Workspace cambió. Se eliminaron {{removed}} mensajes locales en cola; {{retained}} mensajes enviados o en conciliación se conservaron para verificarlos y no se pueden reenviar en el Workspace nuevo.",
  },
  userInput: {
    expired: "Esta pregunta ha caducado. Espera a que el Agent continúe.",
    answerRequired: "Escribe una respuesta antes de continuar.",
  },
  browser: {
    invalidAddress: "Escribe una URL http(s) o un dominio.",
    desktopOnly: "Browser solo está disponible en la aplicación de escritorio.",
    back: "Atrás",
    forward: "Adelante",
    reload: "Recargar",
    addressLabel: "Dirección del navegador",
    addressPlaceholder: "Escribe una URL",
    opening: "Abriendo la página web…",
    agentControlling: "El Agent controla el navegador",
    stopAgentAction: "Detener las acciones del navegador del Agent",
    stop: "Detener",
    operationFailed: "La operación del navegador falló.",
  },
  dock: {
    latestTurn: "Turno más reciente",
    collapseLatest: "Contraer el turno más reciente",
    expandLatest: "Expandir el turno más reciente",
    newReply: "Nueva respuesta",
  },
  subagent: {
    detailUnavailable: "Los detalles en tiempo real no están disponibles.",
    starting: "Iniciando…",
    noTranscript: "No se capturó ninguna transcripción.",
    active: "Activos",
    done: "Finalizados",
    empty: "Esta conversación aún no tiene Subagents.",
    back: "Volver a la lista de Subagents",
    detailLimit: "Se alcanzó el límite de detalles en tiempo real; el nombre y el estado de este Subagent siguen disponibles.",
    avatarLabel: "Subagent {{agent}}",
  },
  skillControl: {
    capabilityChecking: "Se está comprobando la capacidad de Plan. Inténtalo de nuevo en un momento.",
    workspaceChanged: "El espacio de trabajo cambió. Inténtalo de nuevo.",
    planUnavailable: "El Agent actual no admite el modo Plan.",
    invalidated: "Este Skill cambió o se eliminó. Quita el chip y selecciónalo de nuevo.",
  },
  skillFailure: {
    "ref-invalid": "Este Skill ya no está disponible. Quita el chip y selecciónalo de nuevo.",
    "requirement-blocked": "Este Skill no está disponible para el Agent o modo Plan actual.",
    "file-too-large": "Este Skill es demasiado grande para cargarlo de forma segura.",
    "changed-during-read": "El Skill cambió mientras se cargaba. Inténtalo de nuevo.",
    "plan-unsupported": "El Agent actual no admite el modo Plan.",
    "invalid-request": "La solicitud de Skill no es válida.",
    "staging-rejected": "No se pudo preparar el Skill de forma segura.",
    "package-invalid": "El paquete Skill no es válido.",
    unavailable: "Skills no está disponible temporalmente.",
    conflict: "El estado de Skills cambió. Actualiza e inténtalo de nuevo.",
    "read-only": "La gestión de Skills está en modo de solo lectura.",
    failed: "La operación de Skill falló. Inténtalo de nuevo.",
  },
  suggestions: {
    chats: "Chats", files: "Archivos", skills: "Skills",
    loadingChats: "Cargando chats…", loadingSkills: "Cargando Skills…",
    noChats: "No hay chats disponibles", noSkills: "No hay Skills disponibles",
    sectionDescription: "Gestionado por {{agent}}", historyDescription: "Conversación de {{agent}} importada",
    hiddenSkills: "Hay {{count}} Skills coincidentes más ocultos. Acota la búsqueda.",
    filesTruncated: "Algunos archivos no se indexaron. Escribe una búsqueda más específica.",
  },
};
