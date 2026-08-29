/**
 * [INPUT]: Depends on AppStore active and pending generation records
 * [OUTPUT]: Provides resolveRunnableApp and resolveBindableApp directory/name projections
 * [POS]: apps/service read projection; keeps lifecycle-state branching out of the AppsService composition root
 */

import type { AppStore } from "../../app-store";

export function resolveRunnableApp(store: AppStore, appId: string) {
  const record = store.get(appId);
  return record?.state === "ready"
    ? { dir: record.dir, name: record.manifest?.name ?? record.displayName }
    : undefined;
}

export function resolveBindableApp(store: AppStore, appId: string) {
  const record = store.get(appId);
  const pendingGeneration = record?.generations.find(
    (generation) =>
      generation.generationId === record.generationBinding.pending?.generationId
  );
  const bindable = record && (
    record.state === "ready" ||
    (record.state === "creating" &&
      (record.manifest?.kind === "base" || pendingGeneration?.manifest.kind === "base"))
  );
  if (!bindable) return undefined;
  return {
    dir: record.dir,
    name: record.manifest?.name ?? pendingGeneration?.manifest.name ?? record.displayName,
  };
}
