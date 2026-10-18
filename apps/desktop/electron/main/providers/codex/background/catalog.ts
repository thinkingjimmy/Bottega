/**
 * [INPUT]: Uses product model-catalog contracts and the lazy native catalog implementation.
 * [OUTPUT]: Exports codexModels with ordered cache invalidation before or after module loading.
 * [POS]: Lightweight descriptor facade; native catalog queries stay outside main startup.
 */
import type { ModelCatalog } from "../../../backends/models/model-catalog";
import type { ResolvedRuntime } from "../../../backends/contracts/types";

let catalog: ModelCatalog<ResolvedRuntime> | undefined;
let invalidated = false;
async function load() {
  catalog ??= (await import("./models")).codexModelCatalog;
  if (invalidated) { invalidated = false; catalog.invalidate(); }
  return catalog;
}
export const codexModels: ModelCatalog<ResolvedRuntime> = {
  list: async (...args) => (await load()).list(...args),
  cached: async (...args) => (await load()).cached(...args),
  invalidate: () => { if (catalog) catalog.invalidate(); else invalidated = true; },
};
