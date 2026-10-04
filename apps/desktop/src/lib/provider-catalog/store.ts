/**
 * [INPUT]: Depends on the Provider catalog's IPC contract (type only), the zod-free built-in descriptors and `window.providerCatalog`.
 * [OUTPUT]: Provides providerCatalogStore (getSnapshot / subscribe over the catalog snapshot, fenced by revision), ProviderEntry,
 *           isAgentBackendId (the narrowing to an id main stores) and firstProviderId (the default: first available storable entry, else the first built-in).
 * [POS]: The renderer's one view of the dynamic Provider catalog (TASK-11 S4). Before main's first snapshot, and in windows without
 *        the bridge (App window, Dock, notch, tests), it answers the four built-ins exactly as main's snapshot starts, so nothing
 *        flashes or reorders when the real one lands. Main validates the snapshot; the renderer never re-parses it.
 */
import type { AgentBackendId } from "../../../shared/ipc/agent/agent-ipc";
import type { ProviderCatalogBridge, ProviderCatalogSnapshot } from "../../../shared/providers/catalog-ipc";
import { BUILTIN_PROVIDER_DESCRIPTORS } from "../../../shared/providers/builtin";

declare global { interface Window { providerCatalog?: ProviderCatalogBridge } }

export type ProviderEntry = ProviderCatalogSnapshot["entries"][number];

/* Built on first read: nothing here runs at module load. (The descriptors' module still evaluates at load and carries zod through its
   option module, so a zod-free window such as the notch task panel imports Agent identity from the UI leaf, not agent-backends.) */
let builtins: ProviderCatalogSnapshot | undefined;
const builtinSnapshot = () => builtins ??= Object.freeze({
  revision: 0,
  entries: BUILTIN_PROVIDER_DESCRIPTORS.map((descriptor) => ({
    id: descriptor.providerId, displayName: descriptor.displayName, source: "builtin" as const, available: true,
    capabilities: descriptor.capabilities, purposes: descriptor.purposes, configFields: descriptor.configFields,
  })),
});

/* null until main answers: the first real snapshot is taken whatever its revision, every later one only when newer. */
let received: ProviderCatalogSnapshot | null = null;
let watching = false;
const listeners = new Set<() => void>();

function adopt(next: ProviderCatalogSnapshot) {
  if (received && next.revision <= received.revision) return;
  received = next;
  for (const listener of listeners) listener();
}

function watch() {
  const bridge = typeof window === "undefined" ? undefined : window.providerCatalog;
  if (watching || !bridge) return;
  watching = true;
  /* Subscribe before reading: a push that overtakes the read is kept, and the fence drops whichever is older. */
  bridge.onChanged(adopt);
  void bridge.snapshot().then(adopt, (error: unknown) => console.warn("[provider-catalog] snapshot read failed; built-ins shown", error));
}

/** The one narrowing from a catalog id to an id main stores today (the built-ins until S3); never a cast. */
export const isAgentBackendId = (value: string): value is AgentBackendId =>
  BUILTIN_PROVIDER_DESCRIPTORS.some((descriptor) => descriptor.providerId === value);

/** Where a choice starts when nothing is chosen yet: the first available entry main can store, else the first built-in. */
export const firstProviderId = (snapshot: ProviderCatalogSnapshot = providerCatalogStore.getSnapshot()): AgentBackendId =>
  snapshot.entries.map((entry) => entry.available ? entry.id : "").find(isAgentBackendId)
    ?? BUILTIN_PROVIDER_DESCRIPTORS.map((descriptor) => descriptor.providerId).find(isAgentBackendId)!;

export const providerCatalogStore = {
  getSnapshot(): ProviderCatalogSnapshot { watch(); return received ?? builtinSnapshot(); },
  subscribe(listener: () => void) { watch(); listeners.add(listener); return () => { listeners.delete(listener); }; },
};
