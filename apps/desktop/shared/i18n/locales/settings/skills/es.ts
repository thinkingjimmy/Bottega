/**
 * [INPUT]: Depends on the settingsSkillsEn structural type
 * [OUTPUT]: Provides settingsSkillsEs, the Spanish Settings › Skills catalog
 * [POS]: Spanish leaf of shared/i18n/locales/settings/skills; loaded on demand by the matching top-level locale
 */

import type { settingsSkillsEn } from "./en";

export const settingsSkillsEs: typeof settingsSkillsEn = {
  tabs: { skills: "Skills", extensions: "Extensiones" }, refresh: "Actualizar Skills", importTitle: "Añadir Skills",
  description: "Importa una vez en tu Library personal y usa los Skills activados en todas las conversaciones compatibles.",
  back: "Atrás", localFolder: "Carpeta local", chooseFolder: "Elegir carpeta…", importPrimary: "Importar todo", importSelected: "Importar y activar {{count}}",
  backend: { codex: "Codex", claude: "Claude", kimi: "Kimi", opencode: "OpenCode" },
  sourceKind: { "local-folder": "Local", adopted: "Importado", extension: "Extensión" },
  selectSkill: "Seleccionar {{name}}", enable: "Activar", disable: "Desactivar", delete: "Eliminar", gotoPackage: "Ver extensión",
  batch: { selected: "{{count}} seleccionados", done: "Listo" },
  emptyTitle: "Aún no hay Skills personales", emptyScanning: "Buscando Skills en tus Agents instalados…",
  emptyLead: "Se encontraron {{count}} Skills en tus Agents. Impórtalos una vez para usarlos en todas las conversaciones compatibles.",
  emptyNothingHint: "No hay Skills importables. Instala una extensión o elige una carpeta local.",
  readOnly: "La gestión de Skills es de solo lectura",
  budget: "{{count}} activados · lista de sesión ≈ {{size}} (estimada con los Skills activos de la Library)", search: "Buscar Skills", noMatches: "No hay Skills coincidentes.",
  confirmDeleteTitle: "¿Eliminar Skills?", confirmDeleteBody: "Eliminar permanentemente {{count}} Skills de tu Library personal.", confirmDeleteAction: "Eliminar",
  footerImport: "Importar tus Skills existentes →", footerManage: "Gestionar Skills",
  contentState: { downloading: "Descargando…", missing: "No está en este dispositivo" },
  noticeSlugConflict: "Renombrado en otro dispositivo",
  error: { failed: "La operación de Skill falló. Inténtalo de nuevo." },
  reason: {
    "missing-skill-md": "Falta SKILL.md", "invalid-frontmatter": "Los metadatos de SKILL.md son inválidos", "invalid-name": "El nombre del Skill no es válido",
    "skill-md-too-large": "SKILL.md es demasiado grande", "too-many-directories": "Demasiadas carpetas anidadas", "too-many-candidates": "Demasiados candidatos",
    symlink: "No se aceptan enlaces simbólicos", "unsafe-path": "Una ruta sale de la carpeta Skill", "not-a-directory": "No es una carpeta",
    unreadable: "No se puede leer la carpeta", missing: "Falta la carpeta", changed: "La carpeta cambió durante la lectura", timeout: "La detección agotó el tiempo",
    "source-gone": "El origen no está disponible", "postcondition-changed": "El estado cambió durante la operación", "acquisition-failed": "La importación falló",
    "ref-invalid": "La referencia del Skill es inválida", unknown: "No se puede verificar el estado",
  },
};
