/**
 * [INPUT]: No runtime dependencies; translated Dock plugin copy.
 * [OUTPUT]: Provides dock catalog strings for es.
 * [POS]: Nested workbench plugin catalog, consumed by Dock cards, settings and health.
 */
export const dock = {
  "name": "Bottega Dock",
  "summary": "Accesos a apps y widgets de uso. Conserva el Dock del sistema o sustitúyelo tras confirmar.",
  "description": "Bottega Dock sitúa Apps, accesos del sistema y widgets de uso en el borde de la pantalla.\n\nDock está en fase Alpha y desactivado por defecto. Elige una disposición y un modo. La sustitución requiere una instalación firmada y verificada, y tu confirmación. Al salir de Bottega o desactivar Dock, se restaura el Dock del sistema.",
  "systemRequirement": "macOS {{version}} · Chip de Apple",
  "replacementAvailable": "Disponible tras confirmar",
  "replacementChecking": "Verificando la instalación…",
  "replacementDevelopment": "Versión de desarrollo: solo coexistencia",
  "replacementUnverified": "No se pudo verificar la firma de la instalación. Instala una copia firmada de Bottega.",
  "replacementHelperMissing": "Falta el asistente de recuperación. Reinstala Bottega.",
  "running": "Dock en ejecución",
  "off": "Desactivado",
  "loading": "Comprobando Dock…",
  "unsupported": "No disponible en este equipo",
  "recoveryPending": "La restauración requiere atención. Reintenta la restauración en los ajustes del Dock.",
  "coexist": "Junto al Dock del sistema",
  "replace": "Reemplaza el Dock del sistema",
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
    "platform": "Requiere macOS 27",
    "architecture": "Requiere un chip de Apple",
    "osVersion": "Requiere macOS 27",
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
