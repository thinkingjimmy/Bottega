/**
 * [INPUT]: Depends on React's useSyncExternalStore and the Provider catalog store.
 * [OUTPUT]: Provides useProviderCatalog (the current catalog snapshot) and useProviderName (a Chat's Agent name for any Provider id).
 * [POS]: React adapter over provider-catalog/store; lists that iterate Providers read it instead of a closed id list (TASK-11 S4).
 */
import { useCallback, useSyncExternalStore } from "react";
import { providerDisplayName } from "../agent/agent-backends";
import { providerCatalogStore } from "./store";

export const useProviderCatalog = () =>
  useSyncExternalStore(providerCatalogStore.subscribe, providerCatalogStore.getSnapshot, providerCatalogStore.getSnapshot);

/** A Chat's Agent name for any Provider id: a package Provider's declared name, a built-in's product name. */
export function useProviderName() {
  const catalog = useProviderCatalog();
  return useCallback((id: string) => providerDisplayName(id, catalog), [catalog]);
}
