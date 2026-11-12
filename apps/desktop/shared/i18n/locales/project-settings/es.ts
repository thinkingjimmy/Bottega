/**
 * [INPUT]: No runtime dependencies
 * [OUTPUT]: Provides projectSettingsEs, the Spanish Project Settings catalog
 * [POS]: Spanish leaf of shared/i18n/locales/project-settings; loaded on demand by the matching top-level locale
 */
import { workspaceCopy } from "@ai-chat/ui/workspace-copy/es";


export const projectSettingsEs = {
  entry: workspaceCopy.project.settings, open: "Abrir ajustes del Project", title: workspaceCopy.project.settingsTitle, tabs: { general: "General", personalization: "Personalización", skills: "Skills" },
  general: { sectionBasics: workspaceCopy.project.basics, name: workspaceCopy.project.identity, renameAction: "Renombrar", appearanceAria: workspaceCopy.project.appearanceLabel, memory: "Memory", memoryDisabled: "El servicio Memory está desactivado", memoryPaused: "Memory está en pausa", memoryUnavailable: "Servicio no disponible", memoryScoped: "Este Project tiene un ámbito Memory independiente", memoryShared: "Memory se comparte por Chat o ámbito personal", memoryDelivering: "Entregando Memory importada…", memoryManage: "Gestionar Memory", history: "Importar History", historyHint: "Importa manualmente el historial externo de Agents de este Project. Los cambios posteriores requieren otra importación manual.", appsSection: "Apps", appsDescription: "Las Apps añadidas aquí se pueden usar en las conversaciones de este Project. Pin solo la coloca en la Sidebar; nunca cambia los datos que puede ver.", appsManagedByApp: "Los permisos de este App Project se gestionan en la página App.", placements: { pinControl: "Fijar {{name}} en la Sidebar", grantSummary: "{{grant}} · {{agent}}", unavailableBadge: "No disponible", agentOn: "el Agent puede actuar por ti", agentOff: "solo tú puedes usarla", noGrant: "aún sin autorizar", unavailable: "Esta compilación todavía no se puede ejecutar: arréglala en la página Apps antes de fijarla", empty: "Aún no hay Apps en este Project", emptyHint: "Una vez añadida, aparece en las conversaciones de este Project. Tú decides qué datos puede ver.", loading: "Cargando Apps…", failed: "No se pudieron cargar las Apps.", retry: "Reintentar", pending: "Guardando Pin…", pinFailed: "No se pudo guardar el Pin de esta App." }, baseSection: workspaceCopy.project.baseTitle, baseEmpty: workspaceCopy.project.baseEmpty, baseCreate: workspaceCopy.project.baseCreate, baseOpen: workspaceCopy.project.baseOpen, baseSummary: workspaceCopy.project.baseSummary, baseLoading: "Cargando Project Base", danger: workspaceCopy.project.danger, archiveHint: workspaceCopy.project.archiveHint, detachHint: "Quita el registro local sin borrar la carpeta externa.", appLifecycleHint: "Este App Project sigue el ciclo de su App. Elimina la App desde Apps." },
  instructions: { section: "Instrucciones del Project", description: "Edita los archivos que leen los Agents en este Project.", pointerHint: "Este archivo apunta a AGENTS.md y normalmente no requiere edición.", noWorkspace: "Primero elige una carpeta desde el menú del Project.", bridgeMissing: "La personalización del Project no está disponible.", appReadOnly: "Las instrucciones de App Project son de solo lectura porque pertenecen a la generación App.", appEditGuide: "Abre la página App y continúa en una conversación App Edit.", workspaceChanged: "Cambió la carpeta del Project. Se conservó el borrador.", loading: "Cargando instrucciones", saveFailed: "No se pudieron guardar las instrucciones", outsideWorkspace: "Este archivo apunta fuera de la carpeta del Project.", appManaged: "La generación App gestiona estas instrucciones." },
  skills: {
    empty: "Aún no hay Skills en este Project",
    emptyHint: "Coloca un Skill en {{dir}}/.agents/skills/<nombre>/SKILL.md y actualiza.",
    noWorkspace: "No hay carpeta de Project seleccionada",
    noWorkspaceHint: "Elige una carpeta en el menú del Project para añadir Skills.",
    loadFailed: "No se pudieron cargar los Project Skills.",
    badge: { repo: "Project", user: "Usuario", system: "Sistema", admin: "Admin", extension: "Extensión" },
  },
};
