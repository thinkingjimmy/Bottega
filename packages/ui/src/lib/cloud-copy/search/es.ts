/**
 * [INPUT]: Fixed seven-day client search and measured incomplete-cache states.
 * [OUTPUT]: Shared localized command groups, search, coverage and refresh-protection copy.
 * [POS]: Cloud copy catalog; index progress never implies that chat drafts are saved.
 */
import type { CloudSearchCopy } from "./en";
export const es: CloudSearchCopy = {
  "results": "Resultados",
  "actions": "Acciones rápidas",
  "label": "Buscar conversaciones",
  "placeholder": "Palabras de búsqueda",
  "scope": "Busca títulos y mensajes de los últimos 7 días.",
  "preparing": "Preparando la búsqueda de los últimos 7 días. Los resultados pueden estar incompletos.",
  "updating": "Actualizando la búsqueda. Los resultados pueden estar incompletos.",
  "ready": "La búsqueda está lista.",
  "limited": "La cobertura está incompleta: falta la fecha de parte del contenido o se superan los límites actuales de recursos.",
  "paused": "La búsqueda está en pausa. Conéctate y vuelve a intentarlo.",
  "storageFailed": "No se pudo guardar la caché de búsqueda cifrada. Puedes buscar en esta página, pero actualizarla puede requerir reconstruirla.",
  "unsaved": "La búsqueda sigue preparándose. Actualizar puede requerir volver a procesar el progreso no guardado.",
  "progress": "{titles} títulos · {messages} mensajes indexados",
  "searching": "Buscando…",
  "empty": "No hay coincidencias.",
  "emptyPartial": "No hay coincidencias en el contenido preparado. La búsqueda sigue incompleta.",
  "resultsLimited": "Se muestran las primeras 100 coincidencias. Añade palabras para reducir la búsqueda.",
  "stale": "Este resultado cambió o ya no está disponible. Vuelve a buscar.",
  "retry": "Reintentar la preparación",
  "untitled": "Conversación sin título",
  "titleHit": "Título de conversación",
  "messageHit": "Mensaje",
  "queryInvalid": "Usa un máximo de 256 caracteres y 16 palabras."
};
