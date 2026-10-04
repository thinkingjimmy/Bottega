/**
 * [INPUT]: Depends on profile-relative ledger locations owned by the desktop composition root.
 * [OUTPUT]: Classifies derived indexes, synchronization, consent, settings and execution custody for isolated recovery.
 * [POS]: Closed recovery policy; unclassified durable owners retain the conservative custody boundary.
 */
export type RecoveryCategory = "cache" | "sync" | "authorization" | "custody" | "settings";
const caches = new Set(["history-import/index-v1.json", "history-import/memory-watermarks-v2.json", "chat-artifacts/index.json",
  "design/canvas-registry.json", "app-compatibility/requests.json"]);
const authorizations = new Set(["history-import/memory-grants-v2.json", "agent-extensions/projections.json"]);
export function recoveryCategory(path: string): RecoveryCategory {
  if (path === "settings.json" || path === "apps/preferences.json") return "settings";
  if (caches.has(path) || /(?:^|\/)(?:recall-stats|discovery-cache)(?:-v\d+)?\.json$/.test(path)) return "cache";
  if (authorizations.has(path) || /(?:^|\/)policy-v3\.json$/.test(path)) return "authorization";
  if (path === "cloud-sync-binding.json" || /^skills-sync\/[^/]+\/state\.json$/.test(path) ||
      /^(?:cloud-artifacts|cloud-drafts)\//.test(path)) return "sync";
  return "custody";
}
