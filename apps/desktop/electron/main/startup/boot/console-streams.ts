/**
 * [INPUT]: Depends on the process's stdout and stderr streams only.
 * [OUTPUT]: Provides guardConsoleStreams, called first by every main entry, so a console write whose reader is gone never throws.
 * [POS]: Entry-only startup infrastructure beside compile-cache.ts; it must not reach into any service.
 */

/* stdout and stderr belong to whoever launched main: a terminal, `pnpm dev`, launchd. When that reader goes first (the terminal
   closes, Ctrl+C ends pnpm while Electron is still quitting), every later console write fails with EIO or EPIPE. Unhandled, the
   stream error is an uncaught exception and Electron covers a normal quit with a crash dialog. A log line nobody can read is
   simply lost; nothing written to the console is worth failing for. */
export function guardConsoleStreams() {
  for (const stream of [process.stdout, process.stderr]) stream.on("error", () => undefined);
}
