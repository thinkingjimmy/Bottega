/**
 * [INPUT]: Depends only on the Zod-free canonical Provider identity leaf.
 * [OUTPUT]: Provides quotaVersionIndependent for native and remote account-query admission/presentation.
 * [POS]: Dedicated quota policy entry; reader-only consumers do not load Provider initialization.
 */
import { BUILTIN_PROVIDER_IDS } from "../../chats/backend-id";

/** Account quota queries keep their own admission instead of inheriting Chat runtime qualification. */
export function quotaVersionIndependent(backend: string | undefined) {
  return backend === BUILTIN_PROVIDER_IDS.codex;
}
