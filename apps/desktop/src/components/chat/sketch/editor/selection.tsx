/**
 * [INPUT]: Depends on selected visible bounds and source resize permissions.
 * [OUTPUT]: Provides independent eight-way or proportional four-corner accessible handles.
 * [POS]: DOM-only selection chrome; expanded small-object targets never change geometric anchors.
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import type { SketchElement } from "../model/document";
import {
  CORNERS,
  HANDLES,
  clamp,
  type Bounds,
  type Handle,
} from "../model/geometry/transform";
const positions: Record<Handle, readonly [number, number, string]> = {
  nw: [0, 0, "↖"],
  n: [0.5, 0, "↑"],
  ne: [1, 0, "↗"],
  e: [1, 0.5, "→"],
  se: [1, 1, "↘"],
  s: [0.5, 1, "↓"],
  sw: [0, 1, "↙"],
  w: [0, 0.5, "←"],
};
export function SelectionHandles({
  element,
  bounds,
  side,
  scale,
  disabled,
  onStart,
}: {
  element: SketchElement;
  bounds: Bounds;
  side: number;
  scale: number;
  disabled: boolean;
  onStart(handle: Handle, event: ReactPointerEvent<HTMLButtonElement>): void;
}) {
  const { t } = useAppTranslation();
  const handles =
    element.kind === "text"
      ? CORNERS
      : element.kind === "shape" ||
          (element.kind === "ink" && element.resizeMode === "free")
        ? HANDLES
        : [];
  const width = Math.min(side - 44, Math.max(132, bounds.width * scale)),
    height = Math.min(side - 44, Math.max(132, bounds.height * scale));
  const left = clamp(
    (bounds.x + bounds.width / 2) * scale - width / 2,
    22,
    Math.max(22, side - width - 22),
  );
  const top = clamp(
    (bounds.y + bounds.height / 2) * scale - height / 2,
    22,
    Math.max(22, side - height - 22),
  );
  return (
    <>
      <div
        data-sketch-selection
        className="pointer-events-none absolute border border-blue-600"
        style={{
          left: bounds.x * scale,
          top: bounds.y * scale,
          width: bounds.width * scale,
          height: bounds.height * scale,
        }}
      />
      {handles.map((handle) => (
        <button
          key={handle}
          type="button"
          data-sketch-handle={handle}
          disabled={disabled}
          aria-label={t("sketch.handle", { direction: positions[handle][2] })}
          onPointerDown={(event) => onStart(handle, event)}
          className="absolute grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          style={{
            left: left + positions[handle][0] * width,
            top: top + positions[handle][1] * height,
            cursor: handle + "-resize",
          }}
        >
          <span className="size-3 rounded-[3px] border border-blue-600 bg-white" />
        </button>
      ))}
    </>
  );
}
