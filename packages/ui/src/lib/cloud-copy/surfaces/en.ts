/**
 * [INPUT]: The App GUI entry states of TASK-22 (approved copy, 2026-09-27) with {{app}} and {{computer}} placeholders.
 * [OUTPUT]: The reference English App GUI entry copy and the closed CloudSurfaceCopy type.
 * [POS]: Cloud copy catalog for the App GUI entry (TASK-21 artboard 11); the state keys match Cloud Web's SurfaceStatus.
 */
export const en = {
  "open": "Open App",
  "appsDescription": "Open synced Apps, or read and edit their records.",
  "yourComputer": "your computer",
  "loading": "Opening {{app}}…",
  "updated": "{{app}} was updated to the latest version.",
  "expiredTitle": "This view timed out",
  "expiredBody": "{{app}} was idle for a while. Reload to continue.",
  "reload": "Reload",
  "staleTitle": "A newer version is ready",
  "staleBody": "{{app}} was updated on {{computer}}. Reload to use it.",
  "missingTitle": "{{app}} hasn’t finished syncing",
  "missingBody": "Some files from {{computer}} haven’t arrived yet. Try again in a moment.",
  "tryAgain": "Try again",
  "unsupportedTitle": "Open {{app}} on your computer",
  "unsupportedBody": "This App uses an older format that can’t run on the web.",
  "offlineTitle": "{{computer}} is offline",
  "offlineBody": "{{app}} will be available here after {{computer}} comes online and syncs it.",
  "revokedTitle": "{{app}} is no longer available",
  "revokedBody": "It was removed, or this account no longer has access.",
  "failedTitle": "{{app}} couldn’t open",
  "failedBody": "Something went wrong while loading it."
};
export type CloudSurfaceCopy = { [K in keyof typeof en]: string };
