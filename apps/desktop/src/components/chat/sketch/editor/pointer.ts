/**
 * [INPUT]: Depends on editor transactions, geometric transforms, eraser client, and measured canvas ports.
 * [OUTPUT]: Provides capture-owned drawing/move/resize gestures and imperative canvas rendering.
 * [POS]: Pointer controller separated from React rendering; previews remain outside formal history.
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  composerOwnerValid,
  type ComposerOwner,
} from "@/lib/chat-composer-store";
import type {
  ShapeElement,
  SketchDocument,
  SketchElement,
  StrokeElement,
} from "../model/document";
import { elementBounds, topmostElement } from "../model/erasure/hit-test";
import { preflightResize } from "../model/erasure/gesture";
import { shapeEnd } from "../model/geometry/primitives";
import {
  clamp,
  identityTransform,
  moveTransform,
  resizeTransform,
  type Bounds,
  type Handle,
  type Point,
} from "../model/geometry/transform";
import { assertBudget, SOURCE_BYTES } from "../model/budget";
import { drawDocument, drawElement } from "../render/draw";
import { sampleColor } from "../render/export";
import { glyphSweepHit, textMetricsPort } from "../render/text";
import { EraserClient } from "../worker/client";
import type { SketchEditor } from "./state";
type Gesture = { pointerId: number; start: Point; before: SketchDocument } & (
  | { kind: "pen"; points: number[]; element: StrokeElement }
  | { kind: "shape"; element: ShapeElement }
  | {
      kind: "move" | "resize";
      element: SketchElement;
      bounds: Bounds;
      handle?: Handle;
    }
  | { kind: "eraser" }
);
type PointerPorts = {
  board(): HTMLDivElement | null;
  side(): number;
  paint(): void;
  cursor(point: Point): void;
  hover(point: Point): void;
};
export class SketchPointer {
  gesture: Gesture | null = null;
  readonly eraser: EraserClient;
  private boundPorts?: PointerPorts;
  bindPorts(ports: PointerPorts) {
    this.boundPorts = ports;
  }
  get ports(): PointerPorts {
    if (!this.boundPorts) throw new Error("SKETCH_SURFACE_UNAVAILABLE");
    return this.boundPorts;
  }
  constructor(
    readonly editor: SketchEditor,
    owner: ComposerOwner,
  ) {
    this.eraser = new EraserClient({
      current: () => ({
        revision: editor.history.revision,
        owner:
          owner.chatId +
          ":" +
          owner.epoch +
          (composerOwnerValid(owner) ? "" : ":expired"),
        incarnationId: owner.incarnationId,
      }),
      preview: (document) => editor.setPreview(document),
      final: (document, metrics) => {
        editor.phase = "idle";
        editor.commit(document);
        this.ports
          .board()
          ?.dispatchEvent(
            new CustomEvent("sketch:erasure-metrics", {
              detail: metrics,
              bubbles: true,
            }),
          );
      },
      cancelled: (error) => {
        const active = this.gesture;
        this.gesture = null;
        const board = this.boundPorts?.board();
        if (active && board?.hasPointerCapture(active.pointerId))
          board.releasePointerCapture(active.pointerId);
        editor.phase = "idle";
        editor.setPreview(null);
        if (error)
          editor.report(
            new Error(
              error === "SKETCH_BUDGET" ? "SKETCH_ERASE_BUDGET" : error,
            ),
          );
        else editor.changed();
      },
      glyphHit: glyphSweepHit,
      text: textMetricsPort,
    });
  }
  get active() {
    return Boolean(this.gesture || this.eraser.busy);
  }
  get scale() {
    return this.ports.side() / 1600;
  }
  point(event: { clientX: number; clientY: number }): Point {
    const bounds = this.ports.board()!.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) * 1600) / bounds.width,
      y: ((event.clientY - bounds.top) * 1600) / bounds.height,
    };
  }
  cancel = () => {
    if (!this.active) return;
    const active = this.gesture;
    this.gesture = null;
    const board = this.ports.board();
    if (active && board?.hasPointerCapture(active.pointerId))
      board.releasePointerCapture(active.pointerId);
    if (this.eraser.busy) this.eraser.cancel();
    if (this.editor.phase !== "saving") this.editor.phase = "idle";
    this.editor.setPreview(null);
    this.editor.changed();
    this.ports.paint();
  };
  dispose() {
    this.cancel();
    this.eraser.cancel();
  }
  start = (event: ReactPointerEvent<HTMLDivElement>) => {
    const editor = this.editor;
    if (
      event.button !== 0 ||
      editor.blocked ||
      editor.confirmClose ||
      (event.target as HTMLElement).closest("button, textarea")
    )
      return;
    const p = this.point(event);
    this.ports.cursor(p);
    if (editor.textDraft && !editor.dropper) {
      if (editor.finishText()) this.ports.board()?.focus();
      return;
    }
    if (editor.dropper) {
      const draft = editor.textDraft;
      const source = draft
        ? {
            ...editor.document,
            elements: [
              ...editor.document.elements.filter(
                (element) => element.id !== draft.value.id,
              ),
              draft.value,
            ],
          }
        : editor.displayDocument;
      try {
        editor.setColor(sampleColor(source, p.x, p.y));
        editor.patch({ dropper: false });
      } catch (error) {
        editor.report(error);
      }
      return;
    }
    this.ports.board()?.focus();
    event.preventDefault();
    if (editor.tool === "text") {
      const target = topmostElement(
        editor.document.elements,
        p,
        6 / this.scale,
        textMetricsPort,
      );
      editor.beginText(p, target?.kind === "text" ? target : undefined);
      return;
    }
    const before = editor.document,
      base = { pointerId: event.pointerId, start: p, before };
    if (editor.tool === "select") {
      const target = topmostElement(
        before.elements,
        p,
        6 / this.scale,
        textMetricsPort,
      );
      editor.select(target?.id ?? null);
      if (!target) return;
      this.gesture = {
        ...base,
        kind: "move",
        element: target,
        bounds: elementBounds(target, textMetricsPort),
      };
      editor.phase = "moving";
    } else if (editor.tool === "pen") {
      const element: StrokeElement = {
        id: crypto.randomUUID(),
        kind: "stroke",
        color: editor.color,
        transform: identityTransform(),
        points: new Float64Array([p.x, p.y]),
        strokeWidth: editor.penWidth,
      };
      this.gesture = { ...base, kind: "pen", points: [p.x, p.y], element };
      editor.phase = "drawing";
    } else if (editor.tool === "shape") {
      const element: ShapeElement = {
        id: crypto.randomUUID(),
        kind: "shape",
        shapeType: editor.shape,
        color: editor.color,
        transform: identityTransform(),
        start: p,
        end: p,
        strokeWidth: editor.penWidth,
      };
      this.gesture = { ...base, kind: "shape", element };
      editor.phase = "drawing";
    } else {
      this.gesture = { ...base, kind: "eraser" };
      editor.phase = "erasing";
      this.eraser.start(
        before,
        p,
        editor.eraserWidth / 2,
        this.ports.side() ** 2 * 8,
      );
      if (!this.eraser.busy) {
        this.gesture = null;
        return;
      }
    }
    this.ports.board()?.setPointerCapture(event.pointerId);
    editor.changed();
    this.ports.paint();
  };
  move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const editor = this.editor,
      p = this.point(event);
    this.ports.cursor(p);
    const active = this.gesture;
    if (!active || active.pointerId !== event.pointerId) {
      this.ports.hover(p);
      return;
    }
    const samples = (event.nativeEvent.getCoalescedEvents?.() ?? []).map(
      (event) => this.point(event),
    );
    if (!samples.length) samples.push(p);
    try {
      if (active.kind === "eraser") {
        this.eraser.append(samples);
        return;
      }
      if (active.kind === "pen") {
        assertBudget(
          (active.points.length + samples.length * 2) * 16,
          SOURCE_BYTES,
        );
        for (const sample of samples)
          if (
            active.points.at(-2) !== sample.x ||
            active.points.at(-1) !== sample.y
          )
            active.points.push(sample.x, sample.y);
      } else if (active.kind === "shape")
        active.element = {
          ...active.element,
          end: shapeEnd(
            active.element.shapeType,
            active.start,
            { x: clamp(p.x, 0, 1600), y: clamp(p.y, 0, 1600) },
            event.shiftKey,
          ),
        };
      else {
        const delta = { x: p.x - active.start.x, y: p.y - active.start.y };
        const transform =
          active.kind === "move"
            ? moveTransform(
                active.element.transform,
                active.bounds,
                delta.x,
                delta.y,
              )
            : resizeTransform(
                active.element.transform,
                active.bounds,
                active.handle!,
                delta,
                active.element.kind === "text" || event.shiftKey,
                active.element.kind === "text"
                  ? active.element.fontSize
                  : undefined,
              );
        editor.setPreview({
          ...active.before,
          elements: active.before.elements.map((e) =>
            e.id === active.element.id ? { ...e, transform } : e,
          ),
        });
      }
      this.ports.paint();
    } catch (error) {
      this.cancel();
      editor.report(error);
    }
  };
  end = (event: ReactPointerEvent<HTMLDivElement>) => {
    const editor = this.editor,
      active = this.gesture;
    if (!active || active.pointerId !== event.pointerId) return;
    this.move(event);
    if (this.gesture !== active) return;
    this.gesture = null;
    if (active.kind === "eraser") {
      editor.phase = "awaiting-final";
      editor.changed();
      this.eraser.finish(this.point(event));
    } else {
      editor.phase = "idle";
      if (active.kind === "pen")
        editor.commit({
          ...active.before,
          elements: [
            ...active.before.elements,
            { ...active.element, points: Float64Array.from(active.points) },
          ],
        });
      else if (active.kind === "shape") {
        const dx = Math.abs(active.element.end.x - active.start.x) * this.scale,
          dy = Math.abs(active.element.end.y - active.start.y) * this.scale;
        const valid =
          active.element.shapeType === "line" ||
          active.element.shapeType === "arrow"
            ? Math.hypot(dx, dy) >= 3
            : dx >= 3 && dy >= 3;
        if (
          valid &&
          editor.commit({
            ...active.before,
            elements: [...active.before.elements, active.element],
          })
        ) {
          editor.tool = "select";
          editor.select(active.element.id);
        } else editor.changed();
      } else {
        const next = editor.preview;
        if (next) {
          try {
            if (active.kind === "resize")
              preflightResize(
                active.before,
                next.elements.find((e) => e.id === active.element.id)!,
                this.ports.side() ** 2 * 8,
              );
            editor.commit(next);
          } catch {
            editor.setPreview(null);
            editor.report(new Error("SKETCH_RESIZE_BUDGET"));
          }
        } else editor.changed();
      }
    }
    const board = this.ports.board();
    if (board?.hasPointerCapture(event.pointerId))
      board.releasePointerCapture(event.pointerId);
    this.ports.paint();
  };
  resize = (handle: Handle, event: ReactPointerEvent<HTMLButtonElement>) => {
    const editor = this.editor;
    event.stopPropagation();
    if (event.button !== 0 || editor.blocked || !editor.selected) return;
    event.preventDefault();
    event.currentTarget.focus();
    const p = this.point(event),
      element = editor.selected;
    this.gesture = {
      kind: "resize",
      pointerId: event.pointerId,
      start: p,
      before: editor.document,
      element,
      bounds: elementBounds(element, textMetricsPort),
      handle,
    };
    editor.phase = "resizing";
    this.ports.board()?.setPointerCapture(event.pointerId);
    editor.changed();
  };
  doubleClick(event: { clientX: number; clientY: number }) {
    const editor = this.editor;
    if (
      (editor.tool !== "select" && editor.tool !== "text") ||
      editor.blocked ||
      editor.textDraft
    )
      return;
    const target = topmostElement(
      editor.document.elements,
      this.point(event),
      6 / this.scale,
      textMetricsPort,
    );
    if (target?.kind === "text") editor.beginText(this.point(event), target);
  }
  draw(ctx: CanvasRenderingContext2D, scale: number) {
    ctx.save();
    ctx.scale(scale, scale);
    drawDocument(ctx, this.editor.displayDocument, {
      skipTextId: this.editor.textDraft?.original?.id,
    });
    const active = this.gesture;
    if (active?.kind === "pen" || active?.kind === "shape") {
      ctx.beginPath();
      ctx.rect(0, 0, 1600, 1600);
      ctx.clip();
      drawElement(
        ctx,
        active.kind === "pen"
          ? { ...active.element, points: Float64Array.from(active.points) }
          : active.element,
      );
    }
    ctx.restore();
  }
}
