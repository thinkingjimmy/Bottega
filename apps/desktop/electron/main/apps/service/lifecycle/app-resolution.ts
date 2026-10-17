/**
 * [INPUT]: Shared App display names, active/pending store generations and the main availability/retirement guard.
 * [OUTPUT]: Runnable/bindable App directory/name projections excluding disabled and explicitly retired installations.
 * [POS]: apps/service read projection; keeps lifecycle-state branching out of the AppsService composition root
 */

import { appDisplayName } from "../../../../../shared/ipc/apps/apps-ipc";
import type { AppStore } from "../../store/app-store";
import { isRetiredApp } from "../availability/guard";

export function resolveRunnableApp(store: AppStore, appId: string) {
  const record = store.get(appId);
  if (isRetiredApp(record)) return undefined;
  return record?.state === "ready"
    ? { dir: record.dir, name: appDisplayName(record) }
    : undefined;
}

export function resolveBindableApp(store: AppStore, appId: string) {
  const record = store.get(appId);
  if (isRetiredApp(record)) return undefined;
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
    name: appDisplayName({ displayName: record.displayName, manifest: record.manifest ?? pendingGeneration?.manifest ?? null }),
  };
}
