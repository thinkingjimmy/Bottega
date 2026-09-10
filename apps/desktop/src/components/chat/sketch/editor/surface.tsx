/**
 * [INPUT]: Depends on React-Konva, measured canvas ports, and the independent Sketch pointer controller.
 * [OUTPUT]: Provides a square canvas filling the dialog interior, live selection, text overlay, and accurate brush cursor.
 * [POS]: Lazy canvas view; pointer transactions redraw only this surface, outside dialog-wide React state.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Konva from "konva";
import { Stage, Layer, Shape } from "react-konva";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import type { ComposerOwner } from "@/lib/chat-composer-store";
import { elementBounds, topmostElement } from "../model/erasure/hit-test";
import { textMetricsPort } from "../render/text";
import { SketchPointer } from "./pointer";
import { SelectionHandles } from "./selection";
import { SketchTextEditor } from "./text-editor";
import type { SketchEditor } from "./state";
// Bound both Konva backing canvases. PNG rendering is independently fixed at 1600 square.
Konva.pixelRatio = 1;
export function SketchSurface({
  editor,
  owner,
}: {
  editor: SketchEditor;
  owner: ComposerOwner;
}) {
  const { t } = useAppTranslation();
  const well = useRef<HTMLDivElement>(null),
    board = useRef<HTMLDivElement>(null),
    cursor = useRef<HTMLDivElement>(null),
    hover = useRef<HTMLDivElement>(null);
  const canvas = useRef<Konva.Shape>(null),
    frame = useRef<number | null>(null),
    sideRef = useRef(400);
  const [side, setSide] = useState(400),
    [, redrawSelection] = useState(0);
  const scale = side / 1600;
  const [pointer] = useState(() => new SketchPointer(editor, owner));
  useLayoutEffect(() => {
    pointer.bindPorts({
      board: () => board.current,
      side: () => sideRef.current,
      paint: () => canvas.current?.getLayer()?.batchDraw(),
      cursor: (p) => {
        if (!cursor.current) return;
        const scale = sideRef.current / 1600;
        cursor.current.style.transform =
          "translate(" + p.x * scale + "px," + p.y * scale + "px)";
        cursor.current.style.visibility = "visible";
      },
      hover: (p) => {
        if (!hover.current) return;
        const scale = sideRef.current / 1600;
        const element =
          editor.tool === "select" && !editor.blocked
            ? topmostElement(
                editor.document.elements,
                p,
                6 / scale,
                textMetricsPort,
              )
            : undefined;
        hover.current.hidden = !element || element.id === editor.selectedId;
        if (element) {
          const b = elementBounds(element, textMetricsPort);
          Object.assign(hover.current.style, {
            left: b.x * scale + "px",
            top: b.y * scale + "px",
            width: b.width * scale + "px",
            height: b.height * scale + "px",
          });
        }
      },
    });
  }, [editor, pointer]);
  useLayoutEffect(() => {
    sideRef.current = side;
    pointer.ports.paint();
  }, [side, pointer]);
  useLayoutEffect(() => {
    const node = well.current;
    if (!node) return;
    setSide(Math.max(1, Math.min(node.clientWidth, node.clientHeight)));
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setSide(Math.max(1, Math.min(entry.contentRect.width, entry.contentRect.height)));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const redraw = () => {
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        pointer.ports.paint();
        if (editor.selectedId) redrawSelection((value) => value + 1);
      });
    };
    const unsubscribe = editor.subscribeRender(redraw);
    editor.bindCancellation(pointer.cancel);
    window.addEventListener("blur", pointer.cancel);
    return () => {
      unsubscribe();
      pointer.dispose();
      editor.bindCancellation(undefined);
      window.removeEventListener("blur", pointer.cancel);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [editor, pointer]);
  const selected = editor.selected;
  const diameter =
    (editor.tool === "eraser" ? editor.eraserWidth : editor.penWidth) * scale;
  const brush =
    !editor.dropper && (editor.tool === "pen" || editor.tool === "eraser");
  return (
    <div
      ref={well}
      className="relative size-full"
      data-sketch-well
    >
      <div
        ref={board}
        tabIndex={0}
        aria-label={t("sketch.canvas")}
        aria-describedby="sketch-canvas-help"
        data-sketch-canvas
        data-sketch-elements={editor.document.elements.length}
        data-sketch-phase={editor.phase}
        className="relative touch-none bg-white outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        style={{
          width: side,
          height: side,
          cursor: brush ? "none" : editor.dropper ? "crosshair" : "default",
        }}
        onPointerDown={pointer.start}
        onPointerMove={pointer.move}
        onPointerUp={pointer.end}
        onPointerCancel={pointer.cancel}
        onLostPointerCapture={() => {
          if (pointer.gesture) pointer.cancel();
        }}
        onPointerLeave={() => {
          if (cursor.current && !pointer.gesture)
            cursor.current.style.visibility = "hidden";
          if (hover.current) hover.current.hidden = true;
        }}
        onDoubleClick={(event) => pointer.doubleClick(event)}
      >
        <Stage width={side} height={side} listening={false}>
          <Layer listening={false}>
            <Shape
              ref={canvas}
              listening={false}
              perfectDrawEnabled={false}
              sceneFunc={(context) => pointer.draw(context._context, scale)}
            />
          </Layer>
        </Stage>
        <div
          ref={hover}
          hidden
          className="pointer-events-none absolute border border-blue-400/40"
        />
        {selected && !editor.textDraft && (
          <SelectionHandles
            element={selected}
            bounds={elementBounds(selected, textMetricsPort)}
            side={side}
            scale={scale}
            disabled={
              editor.blocked &&
              editor.phase !== "moving" &&
              editor.phase !== "resizing"
            }
            onStart={pointer.resize}
          />
        )}
        <SketchTextEditor editor={editor} scale={scale} />
        <div
          ref={cursor}
          className="pointer-events-none absolute top-0 left-0"
          style={{ visibility: "hidden", display: brush ? "block" : "none" }}
        >
          <span
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              width: Math.max(1, diameter),
              height: Math.max(1, diameter),
              background: editor.tool === "pen" ? editor.color : "transparent",
              border:
                editor.tool === "eraser"
                  ? "1px solid #374151"
                  : "1px solid #FFFFFF",
              boxShadow: "0 0 0 1px #9CA3AF",
            }}
          />
          {diameter < 12 && (
            <>
              <span className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-gray-600" />
              <span className="absolute size-px bg-gray-700" />
            </>
          )}
        </div>
        <span id="sketch-canvas-help" className="sr-only">
          {t("sketch.canvasHelp")}
        </span>
      </div>
    </div>
  );
}
