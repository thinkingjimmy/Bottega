/**
 * [INPUT]: Opt-in numeric camera and admission records from the local editor.
 * [OUTPUT]: Bounded diagnostic events without user text, Event objects or DOM references.
 * [POS]: Canvas performance observation boundary; disabled unless a diagnostic consumer opts in.
 */
export function cameraTrace(phase: string, details: object) {
  if (!(globalThis as typeof globalThis & { __canvasDiagnostics?: boolean }).__canvasDiagnostics) return;
  dispatchEvent(new CustomEvent("bottega:canvas:trace", { detail: { ...details, phase, at: performance.now() } }));
}
