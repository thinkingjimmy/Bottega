/**
 * [INPUT]: Scope-owned live camera, stage CSS size, immutable bounds and interaction pins.
 * [OUTPUT]: Hysteretic resident identities with one release timer per item that survives unrelated renders.
 * [POS]: Linear viewport admission for the bounded Canvas document model.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CanvasBox, CanvasCamera } from "./camera";
import type { CanvasCameraController } from "./controller";
import { VIEWPORT_POLICY } from "./policy";
import { cameraTrace } from "../stage/state/diagnostics";
export type ResidentItem = { id: string; box: CanvasBox; pinned?: boolean };
export function intersectsViewport(box: CanvasBox, camera: CanvasCamera, size: { width: number; height: number }, margin: number) {
  const padding = margin / camera.zoom;
  return box.x + box.width >= camera.x - padding && box.y + box.height >= camera.y - padding && box.x <= camera.x + size.width / camera.zoom + padding && box.y <= camera.y + size.height / camera.zoom + padding;
}
export function useCanvasResidency(controller: CanvasCameraController, items: ResidentItem[], size: { width: number; height: number }) {
  const [resident, setResident] = useState<ReadonlySet<string>>(() => new Set(items.filter(item => item.pinned || intersectsViewport(item.box, controller.read(), size, VIEWPORT_POLICY.prefetchMarginCssPx)).map(item => item.id)));
  const latest = useRef({ controller, items, size });
  const scanner = useRef<{ controller: CanvasCameraController; scan(): void } | null>(null);
  useLayoutEffect(() => {
    latest.current = { controller, items, size };
    if (scanner.current?.controller === controller) scanner.current.scan();
  }, [controller, items, size]);
  useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    let current = true, held = new Set(resident);
    const publish = (next: Set<string>) => {
      if (next.size === held.size && [...next].every(id => held.has(id))) return;
      held = next; setResident(next); cameraTrace("residency", { count: next.size, timers: timers.size, scope: controller.scope });
    };
    const scan = () => {
      const input = latest.current; if (input.controller !== controller) return;
      const camera = controller.read(), next = new Set(held), known = new Set(input.items.map(item => item.id));
      for (const [id, timer] of timers) if (!known.has(id)) { clearTimeout(timer); timers.delete(id); }
      for (const item of input.items) {
        const prefetch = item.pinned || intersectsViewport(item.box, camera, input.size, VIEWPORT_POLICY.prefetchMarginCssPx);
        const retain = item.pinned || intersectsViewport(item.box, camera, input.size, VIEWPORT_POLICY.retentionMarginCssPx);
        if (prefetch) next.add(item.id);
        if (retain && timers.has(item.id)) { clearTimeout(timers.get(item.id)); timers.delete(item.id); }
        if (!retain && held.has(item.id) && !timers.has(item.id)) timers.set(item.id, setTimeout(() => {
          timers.delete(item.id); const input = latest.current;
          if (!current || input.controller !== controller) return;
          const target = input.items.find(value => value.id === item.id);
          if (target?.pinned || target && intersectsViewport(target.box, controller.read(), input.size, VIEWPORT_POLICY.retentionMarginCssPx)) return;
          const released = new Set(held); released.delete(item.id); publish(released);
        }, VIEWPORT_POLICY.releaseDelayMs));
      }
      for (const id of next) if (!known.has(id)) next.delete(id);
      publish(next);
    };
    const owner = { controller, scan }; scanner.current = owner;
    scan(); const unsubscribe = controller.subscribe(scan);
    return () => { current = false; unsubscribe(); for (const timer of timers.values()) clearTimeout(timer); timers.clear(); if (scanner.current === owner) scanner.current = null; };
    // This subscription owns timers for one scope. Model and size changes only rescan current inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller]);
  return resident;
}
