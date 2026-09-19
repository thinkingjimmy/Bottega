/**
 * [INPUT]: Depends on nothing; the contract has to stay loadable from the main entry, preload and the renderer.
 * [OUTPUT]: Provides STARTUP_TRACE_CHANNEL/STARTUP_TRACE_ARGUMENT, the StartupMark shape, and the compile-cache status cell.
 * [POS]: The shared startup-tracing contract; electron/main/startup/startup-trace.ts owns the main-process recorder.
 */

export const STARTUP_TRACE_CHANNEL = "startup:mark";
export const STARTUP_TRACE_ARGUMENT = "--bottega-startup-trace";

export type StartupMark = Readonly<{ name: string; at: number; detail?: string }>;

export type CompileCacheStatus = Readonly<{ status: string; at: number; detail?: string }>;

/* The entry turns the V8 compile cache on before the main bundle is compiled, so the
   recorder that reports it does not exist yet. This cell carries the result across. */
let compileCache: CompileCacheStatus | null = null;

export function recordCompileCacheStatus(status: CompileCacheStatus) {
  compileCache = status;
}

export function compileCacheStatus() {
  return compileCache;
}
