/**
 * [INPUT]: Depends on immutable source/history, text metrics, and localized error projection.
 * [OUTPUT]: Provides editor state, atomic content/text/color edits, dirty close, and separate preview notifications.
 * [POS]: Per-open editor controller retained by the root dialog across Chat route changes.
 */
import {
  type SketchDocument,
  type SketchElement,
  type SketchTool,
  type ShapeType,
  type TextElement,
  valueEqual,
} from "../model/document";
import { SketchHistory } from "../model/history";
import type { Point } from "../model/geometry/transform";
import { textWithinCanvas } from "../render/text";
import { sketchErrorMessage } from "@/lib/chat-composer/errors";
export type EditorPhase =
  | "idle"
  | "drawing"
  | "moving"
  | "resizing"
  | "erasing"
  | "awaiting-final"
  | "saving";
export type TextDraft = Readonly<{
  original?: TextElement;
  value: TextElement;
  composing: boolean;
}>;
export class SketchEditor {
  readonly history: SketchHistory;
  tool: SketchTool;
  shape: ShapeType = "rectangle";
  color = "#000000";
  penWidth = 4;
  eraserWidth = 24;
  selectedId: string | null = null;
  textDraft: TextDraft | null = null;
  textFocusVersion = 0;
  phase: EditorPhase = "idle";
  error = "";
  trimmed = false;
  confirmClose = false;
  popover: "shape" | "color" | null = null;
  dropper = false;
  preview: SketchDocument | null = null;
  cancelGesture: (() => void) | undefined;
  private version = 0;
  private listeners = new Set<() => void>();
  private renderers = new Set<() => void>();
  private colorTransaction?: SketchDocument;
  constructor(
    source: SketchDocument,
    existing: boolean,
    readonly close: () => void,
  ) {
    this.history = new SketchHistory(source);
    this.tool = existing ? "select" : "pen";
  }
  patch(
    value: Partial<
      Pick<
        SketchEditor,
        | "tool"
        | "shape"
        | "penWidth"
        | "eraserWidth"
        | "phase"
        | "error"
        | "confirmClose"
        | "popover"
        | "dropper"
      >
    >,
  ) {
    Object.assign(this, value);
    this.changed();
  }
  bindCancellation(cancel: (() => void) | undefined) {
    this.cancelGesture = cancel;
  }
  get document() {
    return this.history.document;
  }
  get displayDocument() {
    return this.preview ?? this.document;
  }
  get selected() {
    return this.displayDocument.elements.find(
      (element) => element.id === this.selectedId,
    );
  }
  get blocked() {
    return this.phase !== "idle";
  }
  get dirty() {
    const draft = this.textDraft;
    const textDirty = draft
      ? draft.original
        ? !valueEqual(draft.original, draft.value)
        : Boolean(draft.value.text.trim())
      : false;
    return this.history.dirty || textDirty;
  }
  get canSave() {
    return (
      !this.blocked &&
      !this.textDraft?.composing &&
      Boolean(
        this.document.elements.length || this.textDraft?.value.text.trim(),
      )
    );
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.version;
  subscribeRender = (listener: () => void) => {
    this.renderers.add(listener);
    return () => {
      this.renderers.delete(listener);
    };
  };
  changed() {
    this.version++;
    for (const listener of this.listeners) listener();
    for (const render of this.renderers) render();
  }
  setPreview(document: SketchDocument | null) {
    this.preview = document;
    for (const render of this.renderers) render();
  }
  report(error: unknown) {
    this.error = sketchErrorMessage(error);
    this.changed();
  }
  commit(next: SketchDocument) {
    try {
      const result = this.history.commit(next);
      this.preview = null;
      this.error = "";
      this.trimmed ||= result.evicted > 0;
      if (!next.elements.some((e) => e.id === this.selectedId))
        this.selectedId = null;
      this.changed();
      return true;
    } catch (error) {
      this.preview = null;
      this.report(error);
      return false;
    }
  }
  updateElement(element: SketchElement) {
    return this.commit({
      ...this.document,
      elements: this.document.elements.map((e) =>
        e.id === element.id ? element : e,
      ),
    });
  }
  select(id: string | null) {
    this.selectedId = id;
    const selected = this.document.elements.find((e) => e.id === id);
    if (selected) this.color = selected.color;
    this.changed();
  }
  chooseTool(tool: SketchTool) {
    if (this.blocked || !this.finishText()) return false;
    this.tool = tool;
    this.selectedId = null;
    this.dropper = false;
    this.changed();
    return true;
  }
  beginText(point: Point, element?: TextElement) {
    if (this.blocked) return;
    const x = Math.min(1536, Math.max(0, point.x)),
      y = Math.min(1532, Math.max(0, point.y));
    const value: TextElement = element ?? {
      id: crypto.randomUUID(),
      kind: "text",
      text: "",
      color: this.color,
      boxWidth: Math.min(400, 1600 - x),
      fontSize: 48,
      lineHeight: 1.4,
      transform: { x, y, scaleX: 1, scaleY: 1 },
    };
    this.textDraft = { original: element, value, composing: false };
    this.selectedId = null;
    this.color = value.color;
    this.changed();
  }
  updateText(text: string) {
    if (this.textDraft) {
      this.textDraft = {
        ...this.textDraft,
        value: { ...this.textDraft.value, text },
      };
      this.changed();
    }
  }
  setComposing(composing: boolean) {
    if (this.textDraft) {
      this.textDraft = { ...this.textDraft, composing };
      this.changed();
    }
  }
  finishText() {
    const draft = this.textDraft;
    if (!draft) return true;
    if (draft.composing) return false;
    const value = draft.value,
      nonempty = Boolean(value.text.trim());
    if (nonempty && !textWithinCanvas(value)) {
      this.textFocusVersion++;
      this.report(new Error("SKETCH_TEXT_OVERFLOW"));
      return false;
    }
    const elements = draft.original
      ? this.document.elements.flatMap((e) =>
          e.id === value.id ? (nonempty ? [value] : []) : [e],
        )
      : nonempty
        ? [...this.document.elements, value]
        : this.document.elements;
    if (!this.commit({ ...this.document, elements })) {
      this.textFocusVersion++;
      this.changed();
      return false;
    }
    this.textDraft = null;
    this.selectedId = nonempty ? value.id : null;
    this.tool = "select";
    this.changed();
    return true;
  }
  cancelText() {
    if (!this.textDraft) return;
    this.textDraft = null;
    this.error = "";
    this.changed();
  }
  beginColor() {
    if (!this.textDraft && this.selected) this.colorTransaction = this.document;
  }
  setColor(color: string) {
    if (!/^#[0-9a-f]{6}$/i.test(color) || this.blocked) return;
    this.color = color.toUpperCase();
    if (this.textDraft) {
      this.textDraft = {
        ...this.textDraft,
        value: { ...this.textDraft.value, color: this.color },
      };
      this.changed();
      return;
    }
    const selected = this.selected;
    if (this.tool === "select" && selected) {
      const doc = this.colorTransaction ?? this.document;
      const next = {
        ...doc,
        elements: doc.elements.map((e) =>
          e.id === selected.id ? { ...e, color: this.color } : e,
        ),
      };
      if (this.colorTransaction) this.setPreview(next);
      else this.commit(next);
    }
    this.changed();
  }
  finishColor() {
    if (!this.colorTransaction) return;
    const next = this.preview;
    this.colorTransaction = undefined;
    if (next) this.commit(next);
  }
  removeSelected() {
    if (this.blocked || !this.selectedId) return;
    this.commit({
      ...this.document,
      elements: this.document.elements.filter((e) => e.id !== this.selectedId),
    });
  }
  undo(redo = false) {
    if (this.blocked || this.textDraft) return;
    this.finishColor();
    if (redo ? this.history.redo() : this.history.undo()) {
      this.selectedId = null;
      this.preview = null;
      this.error = "";
      this.changed();
    }
  }
  requestClose() {
    if (this.phase === "saving") return;
    if (this.blocked) this.cancelGesture?.();
    this.finishColor();
    if (this.dirty) {
      this.confirmClose = true;
      this.changed();
    } else this.close();
  }
  escape() {
    if (this.textDraft?.composing || this.phase === "saving") return;
    if (this.dropper) {
      this.dropper = false;
      this.popover = "color";
      this.changed();
      return;
    }
    if (this.popover) {
      this.finishColor();
      this.popover = null;
      this.changed();
      return;
    }
    if (this.textDraft) {
      this.cancelText();
      return;
    }
    if (this.blocked) {
      this.cancelGesture?.();
      return;
    }
    this.requestClose();
  }
}
