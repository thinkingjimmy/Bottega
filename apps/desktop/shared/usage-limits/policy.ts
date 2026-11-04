/**
 * [INPUT]: Depends only on the host-selected Provider identity.
 * [OUTPUT]: Provides quotaVersionIndependent for quota admission and native Agent menu demand/presentation.
 * [POS]: Pure account-query policy shared by main and renderer; Chat version admission stays separate.
 */
export function quotaVersionIndependent(backend: string | undefined) {
  return backend === "codex";
}
