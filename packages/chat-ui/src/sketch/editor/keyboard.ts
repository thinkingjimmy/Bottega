/**
 * [INPUT]: Depends on editor transactions, common visible bounds, and anchored world-space transforms.
 * [OUTPUT]: Provides native-input-aware local shortcuts and one history step per held movement/resize key.
 * [POS]: Sketch keyboard controller; global listeners independently honor the common modal scope.
 */
import type { SketchDocument, SketchElement } from "../model/document";
import { elementBounds } from "../model/erasure/hit-test";
import { preflightResize } from "../model/erasure/gesture";
import {
  moveTransform,
  resizeTransform,
  type Handle,
} from "../model/geometry/transform";
import { textMetricsPort } from "../render/text";
import type { SketchEditor } from "./state";
export class SketchKeyboard {
  private active?: {
    before: SketchDocument;
    element: SketchElement;
    handle?: Handle;
    dx: number;
    dy: number;
  };
  constructor(readonly editor: SketchEditor) {}
  down(event: KeyboardEvent) {
    const editor = this.editor;
    if (
      event.isComposing ||
      event.keyCode === 229 ||
      editor.textDraft?.composing
    )
      return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest("input, textarea, [contenteditable=true]")) return;
    if (editor.popover || editor.confirmClose) return;
    const key = event.key.toLowerCase();
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      (key === "z" || key === "y")
    ) {
      event.preventDefault();
      this.finish();
      editor.undo(key === "y" || event.shiftKey);
      return;
    }
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      (editor.blocked && !this.active)
    )
      return;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      this.finish();
      editor.removeSelected();
      return;
    }
    if (!event.key.startsWith("Arrow") || !editor.selected) return;
    event.preventDefault();
    const handle =
      this.active?.handle ??
      (target?.closest<HTMLElement>("[data-sketch-handle]")?.dataset
        .sketchHandle as Handle | undefined);
    if (!this.active) {
      this.active = {
        before: editor.document,
        element: editor.selected,
        handle,
        dx: 0,
        dy: 0,
      };
      editor.phase = handle ? "resizing" : "moving";
      editor.changed();
    }
    const active = this.active,
      b = elementBounds(active.element, textMetricsPort),
      multiplier = event.shiftKey ? 10 : 1;
    const x =
      event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    const y = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (handle) {
      if (active.element.kind === "text") {
        active.dx += ((x || y) * b.width * multiplier) / 100;
        active.dy += ((x || y) * b.height * multiplier) / 100;
      } else {
        active.dx += (x * b.width * multiplier) / 100;
        active.dy += (y * b.height * multiplier) / 100;
      }
    } else {
      active.dx += x * multiplier;
      active.dy += y * multiplier;
    }
    const transform = handle
      ? resizeTransform(
          active.element.transform,
          b,
          handle,
          {
            x: active.dx * (handle.includes("w") ? -1 : 1),
            y: active.dy * (handle.includes("n") ? -1 : 1),
          },
          active.element.kind === "text",
          active.element.kind === "text" ? active.element.fontSize : undefined,
        )
      : moveTransform(active.element.transform, b, active.dx, active.dy);
    editor.setPreview({
      ...active.before,
      elements: active.before.elements.map((e) =>
        e.id === active.element.id ? { ...e, transform } : e,
      ),
    });
  }
  up(event: KeyboardEvent) {
    if (event.key.startsWith("Arrow")) this.finish();
  }
  finish() {
    const active = this.active;
    if (!active) return;
    this.active = undefined;
    const next = this.editor.preview;
    this.editor.phase = "idle";
    if (next) {
      try {
        if (active.handle)
          preflightResize(
            active.before,
            next.elements.find((e) => e.id === active.element.id)!,
          );
        this.editor.commit(next);
      } catch {
        this.editor.setPreview(null);
        this.editor.report(new Error("SKETCH_RESIZE_BUDGET"));
      }
    } else this.editor.changed();
  }
  cancel() {
    if (!this.active) return false;
    this.active = undefined;
    this.editor.phase = "idle";
    this.editor.setPreview(null);
    this.editor.changed();
    return true;
  }
}
