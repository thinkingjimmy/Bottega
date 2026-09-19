/**
 * [INPUT]: Depends on the projectsEn structural type
 * [OUTPUT]: Provides projectsEs, the Spanish Sidebar Projects catalog
 * [POS]: Spanish leaf of shared/i18n/locales/projects; loaded on demand by the matching top-level locale
 */
import { workspaceCopy } from "@ai-chat/ui/workspace-copy/es";


import type { projectsEn } from "./en";

export const projectsEs: typeof projectsEn = {
  provider: {
    loadFailed: "No se pudieron cargar los Projects: {{message}}",
    addFailed: "No se pudo añadir el Project: {{message}}",
    appProjectFailed: "No se pudo crear el Project de la App: {{message}}",
    renameFailed: "No se pudo renombrar el Project: {{message}}",
    appearanceFailed: "No se pudo guardar la apariencia del Project: {{message}}",
    revealFailed: "No se pudo mostrar el Project en el gestor de archivos del sistema: {{message}}",
    sortFailed: "No se pudo guardar el orden de los Projects: {{message}}",
    coordinatorUnavailable: "El coordinador de importación de Projects no está disponible.",
  },
  sortAria: workspaceCopy.project.sortLabel,
  sortLastUpdated: workspaceCopy.project.recent,
  sortManual: workspaceCopy.project.manual,
  add: "Añadir Project",
  empty: "Pulsa + para añadir una carpeta",
  showMore: "Mostrar más",
  moreActions: workspaceCopy.project.more,
  newChatIn: "Nueva tarea en {{name}}",
  missingRecord: "No se encuentra el registro del Project",
  missingName: "Project perdido",
  missingFolder: "No se encuentra la carpeta del Project: {{dir}}",
  editBadge: "Edición",
  baseTag: "Base",
  rename: workspaceCopy.project.rename,
  renameTitle: workspaceCopy.project.renameTitle,
  renameDescription:
    workspaceCopy.project.renameDescription,
  moveChatsToRoot: "Devolver los chats a la raíz",
  rescue: {
    title: "¿Mover los chats fuera de este Project?",
    description: "Falta el registro local de este Project. Los chats confirmados se moverán a la raíz como chats normales e iniciarán una nueva sesión del Agent cuando continúes.",
    retry: "Comprobar recuperación",
    pending: "Esperando la confirmación de la nube. Se conserva el chat original.",
    conflicted: "La versión de la nube ha cambiado. Conserva el chat original para abandonar esta recuperación.",
    confirmed: "Confirmado. Finalizando el traslado local.",
    keepOriginal: "Conservar chat original",
    failed: "El traslado no ha terminado. Comprueba su estado e inténtalo de nuevo.",
    more: "Hay más chats en espera. Revisa este grupo para ver el siguiente.",
    untitled: "Chat sin título",
  },
  unbound: {
    badge: "Falta una carpeta",
    tooltip:
      "Este Project aún no tiene una carpeta en este ordenador. Elige una para trabajar en él.",
    chooseFolder: "Elegir carpeta…",
    chooseFailed: "No se pudo establecer la carpeta del Project: {{message}}",
    turnRefused:
      "Este Project no tiene una carpeta en este ordenador. Elige una en el menú del Project antes de iniciar una tarea.",
  },
  removeLocal: "Quitar Project local",
  removeLocalTitle: "¿Quitar {{name}}?",
  removeLocalDescription:
    "Esto solo quita el Project local de la aplicación. Los archivos del ordenador y los chats existentes no se eliminarán.",
  archiveInsteadTitle: "¿Archivar {{name}} en su lugar?",
  archiveInsteadBase:
    "Este Project posee una Project Base y no se puede quitar de forma segura. Archívalo para conservar intactos el Project, la Base, los archivos y los chats.",
  archiveInsteadMemory:
    "La memoria de grupo compartida pertenece a este Project, por lo que no se puede quitar de forma segura. Archívalo para conservar intactos el Project, la memoria, los archivos y los chats.",
  archiveInsteadManaged:
    "Este Project aún posee un chat con worktree gestionado, por lo que su carpeta de trabajo no se puede desvincular de forma segura. Archívalo o elimina primero ese chat de forma permanente.",
  archiveInsteadBoth:
    "Este Project posee una Project Base y memoria de grupo compartida, por lo que no se puede quitar de forma segura. Archívalo para conservar todos sus datos.",
  archiveInsteadConfirm: "Archivar Project",
  archive: workspaceCopy.project.archive,
  hideAppProject: "Ocultar de Projects",
  archiveTitle: workspaceCopy.project.archiveTitle,
  archiveDescription:
    "«{{name}}» y sus {{chats}} chats saldrán de la Sidebar. Puedes restaurarlos o eliminarlos definitivamente en Settings › Archive; las carpetas de trabajo externas o de una App nunca se eliminan.",
  archiveRootBases: "Bases raíz archivadas con él: {{bases}}.",
  appearance: workspaceCopy.project.appearance,
};
