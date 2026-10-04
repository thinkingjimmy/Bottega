/**
 * [INPUT]: Depends on canvas-confetti types through the React wrapper and a caller-owned canvas/eligibility port
 * [OUTPUT]: Provides fixed initialization options, a bounded two-corner playback controller, and window-local archive celebration commands
 * [POS]: Visual adapter beneath archive feedback; contains failures, operation identity, sizing, timers, and stale completion handling
 */

import type { TCanvasConfettiInstance } from "react-canvas-confetti/dist/types";

export const ARCHIVE_CONFETTI_GLOBAL_OPTIONS = Object.freeze({
  resize: true,
  useWorker: false,
  disableForReducedMotion: true,
});
export const ARCHIVE_CONFETTI_MAX_DURATION = 2_500;
const BURST = {
  particleCount: 50,
  spread: 50,
  startVelocity: 55,
  gravity: 1,
  decay: 0.92,
  ticks: 110,
  scalar: 0.9,
  colors: ["#f97316", "#facc15", "#38bdf8", "#a78bfa", "#34d399", "#fb7185"],
};
type ArchiveOperation = symbol;

function reset(instance: TCanvasConfettiInstance | null) {
  try { instance?.reset(); } catch { /* Visual cleanup must never block an archive action. */ }
}

export function createArchiveConfetti(port: {
  canvas(): HTMLCanvasElement | null;
  canPlay(): boolean;
}) {
  let instance: TCanvasConfettiInstance | null = null;
  let disposed = false;
  let current: { operation: ArchiveOperation; timer: ReturnType<typeof setTimeout> } | null = null;

  const stop = (operation?: ArchiveOperation) => {
    if (!current || (operation && current.operation !== operation)) return;
    clearTimeout(current.timer);
    current = null;
    reset(instance);
  };

  return {
    initialize(next: TCanvasConfettiInstance) {
      if (disposed) { reset(next); return; }
      stop();
      if (instance !== next) reset(instance);
      instance = next;
    },
    play(operation: ArchiveOperation) {
      if (disposed || current || !instance) return false;
      try {
        if (!port.canPlay()) return false;
        const canvas = port.canvas();
        if (!canvas || !canvas.getContext("2d")) return false;
        const { width, height } = canvas.getBoundingClientRect();
        if (width <= 0 || height <= 0) return false;
        // The library uses CSS pixels, including after an idle resize; never multiply by DPR.
        canvas.width = width;
        canvas.height = height;
        const run = { operation, timer: setTimeout(() => stop(operation), ARCHIVE_CONFETTI_MAX_DURATION) };
        current = run;
        const finish = () => { if (current === run) stop(operation); };
        // Observe the first promise before the second fire can throw synchronously.
        const left = Promise.resolve(instance({ ...BURST, origin: { x: 0, y: 1 }, angle: 45 })).catch(finish);
        const right = Promise.resolve(instance({ ...BURST, origin: { x: 1, y: 1 }, angle: 135 })).catch(finish);
        void Promise.all([left, right]).then(finish, finish);
        return true;
      } catch {
        stop(operation);
        return false;
      }
    },
    stop,
    dispose() {
      disposed = true;
      stop();
      reset(instance);
      instance = null;
    },
  };
}

export type ArchiveConfettiController = ReturnType<typeof createArchiveConfetti>;
let host: ArchiveConfettiController | null = null;

export function attachArchiveConfetti(controller: ArchiveConfettiController) {
  host?.dispose();
  host = controller;
  return () => {
    controller.dispose();
    if (host === controller) host = null;
  };
}

export const playArchiveConfetti = (operation: ArchiveOperation) => host?.play(operation);
export const stopArchiveConfetti = (operation?: ArchiveOperation) => host?.stop(operation);
