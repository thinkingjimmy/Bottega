/**
 * [INPUT]: Depends on the settingsToolsEn structural type
 * [OUTPUT]: Provides settingsToolsEs, the Spanish Settings Tools catalog
 * [POS]: Spanish leaf of shared/i18n/locales/settings/tools; loaded on demand by the matching top-level locale
 */

import type { settingsToolsEn } from "./en";

export const settingsToolsEs: typeof settingsToolsEn = {
  globalScopeNote: "Estos ajustes son globales. Cada Project puede sustituirlos sin cambiar esta página.",
  supportReason: {
    "runtime-unavailable": "Runtime no disponible", "builtin-tools-unsupported": "Herramientas integradas no compatibles", "transport-unsupported": "Transporte no compatible",
    "turn-origin-unsupported": "No disponible para este origen de turno", "plan-mode-unsupported": "No disponible en turnos Plan", "security-policy": "Bloqueado por la política de seguridad", unknown: "Backend no disponible",
    minimumRuntimeVersion: "Requiere runtime {{minimumVersion}} o posterior (detectado: {{detectedVersion}})", unknownVersion: "versión desconocida",
  },
  builtin: {
    title: "Herramientas integradas", saveFailed: "No se pudo guardar el ajuste de la herramienta integrada", disabledCount: "{{count}} desactivadas",
    globalDescription: "Los valores globales se aplican en el siguiente turno; cada Project puede sustituir cada herramienta.",
    projectDescription: "Elige la intención de este Project para cada herramienta. Restablecer recupera el valor global.",
    resetAll: "Restablecer todas las sustituciones del Project", resetOne: "Restablecer {{name}} al valor global",
    source: { "global-default": "Valor global", "project-override": "Sustitución del Project" },
    effective: { enabled: "Activado", disabled: "Desactivado", unavailable: "Intención activada; Backend no disponible" },
    domain: { sections: "Sections", subagents: "Subagentes", projects: "Projects", bases: "Bases", search: "Búsqueda", browser: "Browser", design: "Diseño", apps: "Apps" },
    items: {
      list_sections: { label: "Listar Sections", hint: "Ver todos los Chats persistentes y el resumen de sus Bases." },
      read_section: { label: "Leer Section", hint: "Leer la transcripción guardada de otro Chat." },
      send_to_section: { label: "Enviar a Section", hint: "Poner un mensaje en cola para otro Chat e iniciar su Agent." },
      create_section: { label: "Crear Section", hint: "Crear un Chat colaborativo visible y persistente." },
      promote_result_to_section: { label: "Promover el resultado del subagente", hint: "Convertir un resultado de subagente de este turno en una Section inactiva; si se llama tarde solo queda una copia truncada." },
      export_attachment: { label: "Exportar adjunto", hint: "Exportar imágenes del mensaje a este equipo; solo en turnos humanos." },
      spawn_subagent: { label: "Iniciar subagente", hint: "Delegar una subtarea puntual en este turno y esperar el resultado." },
      convert_chat_to_project: { label: "Convertir Chat en Project", hint: "Promover el Chat actual a Project; solo en turnos humanos de Codex o Claude." },
      base_describe: { label: "Describir Base", hint: "Leer metadatos, columnas y revision de una Base." },
      read_base: { label: "Leer Base", hint: "Filtrar, ordenar y paginar filas de una Base: la de este chat, la de otra Section o la de una App adjunta." },
      base_export_csv: { label: "Exportar Base a CSV", hint: "Exportar resultados de una consulta Base como CSV." },
      base_set_view: { label: "Definir vista Base", hint: "Actualizar la configuración de la vista Base actual." },
      base_update_columns: { label: "Actualizar columnas Base", hint: "Renombrar o ajustar columnas existentes." },
      base_add_columns: { label: "Añadir columnas Base", hint: "Añadir columnas nuevas a una Base." },
      base_insert_rows: { label: "Insertar filas Base", hint: "Insertar filas en la Base actual o en la de una App adjunta." },
      base_patch_rows: { label: "Editar filas Base", hint: "Actualizar filas de una Base por campo." },
      base_delete_rows: { label: "Eliminar filas Base", hint: "Eliminar filas concretas de una Base." },
      search_chat_history: { label: "Buscar en el historial", hint: "Encontrar títulos y transcripciones entre Sections." },
      read_chat_history: { label: "Leer este historial", hint: "Leer los mensajes anteriores guardados en este chat." },
      search_bases: { label: "Buscar en Bases", hint: "Encontrar nombres, columnas y texto de celdas entre propietarios de Base." },
      browser_open: { label: "Abrir página web", hint: "Abrir una página HTTP(S); no se emite en turnos Plan." },
      browser_snapshot: { label: "Leer captura web", hint: "Leer el árbol de accesibilidad; no se emite en turnos Plan." },
      browser_act: { label: "Actuar en página web", hint: "Ejecutar acciones web por lotes; no se emite en turnos Plan." },
      browser_tabs: { label: "Listar pestañas web", hint: "Ver pestañas visibles y de esta Section; no se emite en turnos Plan." },
      browser_close: { label: "Cerrar pestaña web", hint: "Cerrar una pestaña de esta Section; no se emite en turnos Plan." },
      design_render_check: { label: "Comprobar renderizado Design", hint: "Renderizar el lienzo Design actual y devolver una captura con avisos anti-slop." },
      validate_app: { label: "Validar App", hint: "Validar el paquete actual en una sesión de edición de App." },
    },
  },
  mcp: {
    title: "Servidores MCP", add: "Añadir servidor", edit: "Editar", delete: "Eliminar {{name}}", emptyTitle: "Aún no hay servidores MCP", addTitle: "Añadir servidor MCP", editTitle: "Editar servidor MCP", dialogDescription: "Solo se admite stdio y el comando debe ser una ruta absoluta. Al guardar, el servidor completo se inyecta en el siguiente turno humano no Plan.", name: "Nombre", command: "Ruta absoluta del comando", args: "Argumentos (uno por línea)", environment: "Variables de entorno", addVariable: "Añadir variable", envName: "Nombre de variable de entorno", envNewValue: "Nuevo valor de {{name}}", envFallbackName: "variable de entorno", retainValue: "Déjalo vacío para conservar el valor", value: "Valor", removeVariable: "Eliminar {{name}}", envNameRequired: "El nombre de la variable no puede estar vacío", envValueRequired: "Introduce un valor nuevo para {{name}}", descriptionLine: "{{transport}} · {{target}} · {{eligibility}} · {{health}}",
    globalDescription: "Gestiona los servidores MCP globales. Los Projects pueden heredarlos o sustituirlos sin cambiar esta lista.",
    projectDescription: "Los servidores del Project son privados. Los servidores globales heredados se pueden sustituir aquí.",
    globalEmptyHint: "Añade aquí un servidor global. Los servidores propios de Projects nunca aparecen en esta página.",
    bridgeMissing: "Los ajustes de servidores MCP no están disponibles en este entorno.",
    projectGroup: "Servidores del Project", projectGroupEmpty: "No hay servidores propios del Project",
    inheritedGroup: "Servidores globales heredados", inheritedGroupEmpty: "No hay servidores globales para heredar",
    allInherited: "Este Project usa actualmente solo los ajustes globales heredados.",
    editGlobally: "Editar servidores MCP globales en Settings", resetOne: "Restablecer {{name}} al valor global",
    conflict: "El servidor cambió en otro lugar. Se cargó el estado más reciente y se conservó tu borrador.",
    source: { "global-default": "Valor global", "project-override": "Sustitución del Project", "project-owned": "Propio del Project" },
    effective: { enabled: "Activado", disabled: "Desactivado", unavailable: "Intención activada; Backend no disponible" },
    eligibility: { eligible: "Activo en el siguiente turno humano no Plan", "remote-policy-unsupported": "Los canales Remote aún no están disponibles", "authenticated-remote-unsupported": "Remote autenticado con headers estáticos no compatible", "query-remote-unsupported": "URL remote con parámetros query no compatible" },
    health: { unobserved: "Estado no observado", healthy: "Protocolo correcto", degraded: "Falló el protocolo; esperando reintento", quarantined: "Estado del proceso desconocido; en cuarentena" },
  },
};
