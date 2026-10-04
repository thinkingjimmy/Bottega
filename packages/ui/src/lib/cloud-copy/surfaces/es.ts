/**
 * [INPUT]: The App GUI entry states of TASK-22 (approved copy, 2026-09-27) with {{app}} and {{computer}} placeholders.
 * [OUTPUT]: Spanish App GUI entry copy.
 * [POS]: Cloud copy catalog for the App GUI entry (TASK-21 artboard 11); the state keys match Cloud Web's SurfaceStatus.
 */
import type { CloudSurfaceCopy } from "./en";
export const es: CloudSurfaceCopy = {
  "open": "Abrir App",
  "appsDescription": "Abre las Apps sincronizadas o consulta y edita sus registros.",
  "yourComputer": "tu ordenador",
  "loading": "Abriendo {{app}}…",
  "updated": "Se cargó la versión más reciente de {{app}}.",
  "expiredTitle": "Esta vista caducó",
  "expiredBody": "{{app}} estuvo inactiva un tiempo. Recarga para continuar.",
  "reload": "Recargar",
  "staleTitle": "Hay una versión nueva",
  "staleBody": "{{app}} se actualizó en {{computer}}. Recarga para usarla.",
  "missingTitle": "{{app}} aún no terminó de sincronizarse",
  "missingBody": "Algunos archivos de {{computer}} todavía no llegaron. Vuelve a intentarlo en un momento.",
  "tryAgain": "Reintentar",
  "unsupportedTitle": "Abre {{app}} en tu ordenador",
  "unsupportedBody": "Esta App usa un formato antiguo que no funciona en la web.",
  "offlineTitle": "{{computer}} está sin conexión",
  "offlineBody": "{{app}} estará disponible aquí cuando {{computer}} se conecte y la sincronice.",
  "revokedTitle": "{{app}} ya no está disponible",
  "revokedBody": "Se eliminó o esta cuenta ya no tiene acceso.",
  "failedTitle": "No se pudo abrir {{app}}",
  "failedBody": "Algo salió mal al cargarla."
};
