/**
 * [INPUT]: Depends on React lazy/error boundaries, effective preferences and the deferred archive canvas
 * [OUTPUT]: Provides one route-independent ArchiveCelebrationHost with replaceable canvas instances and foreground cleanup
 * [POS]: Product window visual host; only its inner canvas remounts when the user or system disables motion
 */

import { Component, lazy, Suspense, type ComponentType, type ReactNode } from "react";
import * as playback from "./controller";
import type { TReactCanvasConfettiProps } from "react-canvas-confetti/dist/types";

// Pass the publishing module instance through the lazy boundary for mixed ESM/CJS hosts.
// Resolve the library before mounting the controller: a suspended canvas can
// otherwise retain an onInit callback from a layout lifetime that was disposed.
const LoadedArchiveCanvas = lazy(() => import("./canvas").then(({ ArchiveCanvas }) => ({ default: ArchiveCanvas })));

class CanvasBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

export function ArchiveCelebrationHost({
  Canvas, enabled, canPlay,
}: { enabled: boolean; canPlay(): boolean; Canvas?: ComponentType<TReactCanvasConfettiProps> }) {
  return enabled ? <CanvasBoundary><Suspense fallback={null}>
    <LoadedArchiveCanvas Canvas={Canvas} canPlay={canPlay} playback={playback} />
  </Suspense></CanvasBoundary> : null;
}
