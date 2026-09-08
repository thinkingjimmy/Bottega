/**
 * [INPUT]: Depends on no runtime modules
 * [OUTPUT]: Provides localized Agent selection, pending, eligibility, and retained-history disclosure
 * [POS]: Chat Agent switch locale leaf
 */

export const chatAgentSwitchEs = {
  "pending": "{{backend}} responderá al próximo mensaje. El historial se conserva aquí.",
  "undo": "Deshacer",
  "details": "Detalles de continuación",
  "explanation": "El nuevo Agent recibe extractos y puede leer registros guardados cuando la herramienta esté disponible. Las imágenes anteriores y el estado de las herramientas no se heredan.",
  "permission": "Permiso: {{from}} → {{to}}",
  "confirming": "Confirmando el envío…",
  "recovering": "Mensaje guardado. Recuperando…",
  "stale": "Este chat ha cambiado. Vuelve a elegir el Agent.",
  "adjacent": "Envía un mensaje nuevo o deshaz el cambio de Agent.",
  "defaultsFailed": "Opciones guardadas; no se pudieron actualizar los valores predeterminados.",
  "divider": "A partir de aquí responde {{backend}}",
  "notInjected": "Parte del historial no se incluyó. Los registros guardados pueden estar disponibles.",
  "storageTrimmed": "Algunos registros anteriores ya no se conservan.",
  "lookupUnavailable": "No se puede consultar más historial en este turno.",
  "running": "Espera a que termine la respuesta.",
  "queue": "Procesa los mensajes pendientes.",
  "recovery": "Completa la recuperación.",
  "readonly": "Este chat es de solo lectura. Retómalo primero con su Agent original.",
  "app-bound": "Este Agent lo establece la App.",
  "archived": "Los chats archivados no pueden cambiar de Agent.",
  "approval": "Resuelve la aprobación pendiente.",
  "plan-review": "Termina la revisión del Plan.",
  "paused": "Reanuda o termina la cadena en pausa.",
  "submission": "Confirma el resultado del envío anterior.",
  "selectionFailed": "No se pudo elegir el Agent: {{message}}",
  "revision-stale": "Este chat ha cambiado. Vuelve a elegir el Agent."
};
