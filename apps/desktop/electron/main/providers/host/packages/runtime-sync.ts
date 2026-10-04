/**
 * [INPUT]: Depends on the Provider catalog port (its snapshot changes and each available package Provider's package).
 * [OUTPUT]: Provides followPackageProviders: calls `forget(id)` once when a package Provider stops being available (disabled, removed, revoked, refused) or its package changes generation, so no runtime fact about the old package outlives it, and `announce(id)` once when one becomes available, so a window that already checked Setup learns of it (d5 F2).
 * [POS]: The d4b follow-up's one seam from the catalog to the runtime registry; the foundation composes it with backendRuntimeRegistry.forget, and the registry itself never reads the catalog.
 */
import type { ProviderCatalogPort } from "../catalog";

export function followPackageProviders(catalog: Pick<ProviderCatalogPort, "snapshot" | "subscribe" | "packageOf">, forget: (id: string) => void,
  announce: (id: string) => void = () => {}) {
  /* id → the package digest its runtime facts were learnt from; a digest change is another executable as far as the facts go. */
  const known = new Map<string, string>();
  const observe = () => {
    for (const entry of catalog.snapshot().entries) {
      if (entry.source !== "package") continue;
      const digest = catalog.packageOf(entry.id)?.packageDigest ?? null;
      const previous = known.get(entry.id);
      if (previous !== undefined && previous !== digest) forget(entry.id);
      /* Newly available: its (unknown) status reaches every window, which then asks for it; a new generation is announced by forget. */
      else if (previous === undefined && digest) announce(entry.id);
      if (digest) known.set(entry.id, digest); else known.delete(entry.id);
    }
  };
  observe();
  return catalog.subscribe(observe);
}
