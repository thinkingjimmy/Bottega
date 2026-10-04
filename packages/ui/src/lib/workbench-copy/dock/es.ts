/**
 * [INPUT]: No runtime dependencies; translated Dock plugin copy.
 * [OUTPUT]: Provides dock catalog strings for es.
 * [POS]: Nested workbench plugin catalog, consumed by Dock cards, settings and health.
 */
export const dock = {
  "name": "Bottega Dock",
  "summary": "Accesos a Apps y widgets de uso junto al Dock de macOS. Desactivado por defecto.",
  "description": "El Bottega Dock se coloca junto al Dock de macOS con accesos a tus Apps y widgets de uso.\n\nEstá desactivado por defecto. Configúralo para elegir su aspecto y cuándo se muestra.",
  "running": "Dock en ejecución",
  "off": "Desactivado",
  "loading": "Comprobando Dock…",
  "unsupported": "No disponible en este equipo",
  "recoveryPending": "La restauración requiere atención. Reintenta la restauración en los ajustes del Dock.",
  "coexist": "Junto al Dock del sistema",
  "replace": "Reemplaza el Dock del sistema",
  "replacementPending": "No disponible en 0.2.0; pendiente de validar su seguridad",
  "autohide": "Ocultar automáticamente",
  "pinned": "Siempre visible",
  "settings": {
    "showHandle": "Mostrar control",
    "privacyMask": "Ocultar valores sensibles",
    "showRunning": "Mostrar Apps abiertas",
    "scale": "Tamaño",
    "visibility": "Visibilidad"
  },
  "labels": {
    "mode": "Modo",
    "phase": "Estado de ejecución",
    "registration": "Agente de restauración",
    "accessibility": "Accesibilidad",
    "automation": "Automatización de Finder",
    "recovery": "Última restauración",
    "sync": "Sincronización del diseño",
    "replacement": "Modo de reemplazo"
  },
  "phase": {
    "inactive": "Inactivo",
    "preparing": "Preparando",
    "active": "Activo",
    "restoring": "Restaurando",
    "suspended": "En pausa"
  },
  "registration": {
    "notRegistered": "Sin registrar",
    "enabled": "Registrado",
    "requiresApproval": "Pendiente de aprobación",
    "notFound": "Falta el servicio de restauración",
    "unsupported": "No disponible en esta compilación",
    "unknown": "No se pudo verificar el registro"
  },
  "permission": {
    "granted": "Permitido",
    "notGranted": "No permitido",
    "unsupported": "Sin comprobar",
    "unknown": "Sin comprobar",
    "needsPrompt": "Solicitar al usar",
    "denied": "Denegado",
    "unavailable": "No disponible"
  },
  "recovery": {
    "none": "Sin restauraciones registradas",
    "restored": "Restaurado",
    "keptExternal": "Se conservaron tus cambios del sistema",
    "failed": "No se pudo confirmar la restauración"
  },
  "sync": {
    "localOnly": "Solo local",
    "synced": "Sincronizado; continúa con el Dock desactivado",
    "pending": "Cambios pendientes de sincronizar",
    "offline": "Sin conexión; diseño conservado localmente",
    "conflict": "Hay que revisar los cambios del diseño",
    "blocked": "Sincronización no disponible",
    "error": "Error al sincronizar; diseño conservado"
  },
  "unsupportedReason": {
    "platform": "Requiere macOS 15 o posterior",
    "architecture": "Requiere un chip de Apple",
    "osVersion": "Requiere macOS 15 o posterior",
    "helperMissing": "Falta el asistente de Dock. Reinstala Bottega."
  },
  "effects": {
    "restore": "Restaurar el Dock del sistema antes de completar el cierre.",
    "unregister": "Anular el registro del agente tras confirmar la restauración.",
    "hide": "Ocultar la barra, el menú y los widgets de Dock. Conservar el diseño y seguir sincronizando cuando sea posible."
  },
  "capabilities": {
    "launch": "Abre Apps y accesos del sistema en este Mac",
    "usage": "Lee los datos locales de uso y límites",
    "sync": "Mantiene la sincronización con el Dock desactivado",
    "permissions": "Tú controlas los permisos opcionales de accesibilidad y automatización de Finder"
  }
};
