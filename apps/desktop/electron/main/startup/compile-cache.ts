/**
 * [INPUT]: Depends on node:module's compile-cache API (Node >= 22.1), node:path, and the shared compile-cache status cell.
 * [OUTPUT]: Provides enableStartupCompileCache, called by every main entry before the composition root is imported.
 * [POS]: Entry-only startup infrastructure; it must not reach into any service, because the main bundle is not compiled yet when it runs.
 */

import nodeModule from "node:module";
import { join } from "node:path";
import { recordCompileCacheStatus } from "../../../shared/startup-trace";

type CompileCacheResult = Readonly<{ status: number; message?: string; directory?: string }>;
type CompileCacheApi = {
  enableCompileCache?(directory?: string): CompileCacheResult;
  getCompileCacheDir?(): string | undefined;
  constants?: { compileCacheStatus: Record<string, number> };
};

const api = nodeModule as typeof nodeModule & CompileCacheApi;

const statusName = (status: number) =>
  Object.entries(api.constants?.compileCacheStatus ?? {})
    .find(([, value]) => value === status)?.[0]
    ?.toLowerCase() ?? `status-${status}`;

/**
 * The 5.4 MB main bundle costs ~135 ms of V8 compilation on every launch. The cache
 * only covers modules compiled after this call, so entries call it before importing
 * the composition root, and only once the identity/userData choice is final.
 */
export function enableStartupCompileCache(app: { getPath(name: "userData"): string }) {
  const at = performance.now();
  if (!api.enableCompileCache) {
    recordCompileCacheStatus({ status: "unsupported", at });
    return;
  }
  try {
    const directory = join(app.getPath("userData"), "v8-compile-cache");
    const result = api.enableCompileCache(directory);
    recordCompileCacheStatus({
      status: statusName(result.status),
      at,
      detail: result.message ?? api.getCompileCacheDir?.() ?? directory,
    });
  } catch (cause) {
    recordCompileCacheStatus({ status: "failed", at, detail: String(cause) });
  }
}
