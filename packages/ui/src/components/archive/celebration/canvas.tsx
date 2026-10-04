/**
 * [INPUT]: React lifecycle, body Portal, react-canvas-confetti, motion preferences and the archive playback adapter.
 * [OUTPUT]: A lazily loaded, pointer-transparent archive canvas that preserves native window dragging, with instance, foreground and effect-lifetime cleanup.
 * [POS]: Visual implementation loaded after motion admission; the parent host contains import and rendering failures.
 */
import { useLayoutEffect, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import ReactCanvasConfetti from "react-canvas-confetti";
import type { TReactCanvasConfettiProps } from "react-canvas-confetti/dist/types";
import * as defaultPlayback from "./controller";
import type { ArchiveConfettiController } from "./controller";

export function ArchiveCanvas({ canPlay, Canvas = ReactCanvasConfetti, playback = defaultPlayback }: { canPlay(): boolean; Canvas?: ComponentType<TReactCanvasConfettiProps>; playback?: typeof defaultPlayback }) {
  const container = useRef<HTMLDivElement>(null);
  const [controller, setController] = useState<ArchiveConfettiController | null>(null);
  useLayoutEffect(() => {
    // Each effect lifetime owns its callbacks, including Strict Mode's rehearsal lifetime.
    const next = playback.createArchiveConfetti({
      canvas: () => container.current?.querySelector("canvas") ?? null,
      canPlay,
    });
    const detach = playback.attachArchiveConfetti(next);
    setController(next);
    const stop = () => next.stop();
    const visibility = () => { if (document.visibilityState !== "visible") stop(); };
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", visibility);
      detach();
    };
  }, [canPlay, playback]);

  return createPortal(
    <div ref={container} aria-hidden="true" data-archive-celebration className="pointer-events-none">
      {/* Explicit no-drag would erase Electron's title-bar regions despite pointer-events-none. */}
      {controller && <Canvas
        className="pointer-events-none fixed inset-0 z-40 h-full w-full"
        globalOptions={playback.ARCHIVE_CONFETTI_GLOBAL_OPTIONS}
        onInit={({ confetti }) => controller.initialize(confetti)}
      />}
    </div>,
    document.body
  );
}
