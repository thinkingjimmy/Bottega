/**
 * [INPUT]: Depends on compact coverage validation and shared geometry types.
 * [OUTPUT]: Provides SketchDocument and element contracts, immutable defaults, validation, and equality.
 * [POS]: Renderer source format; independent of PNG, submission DTOs, and the canvas library.
 */
import type { Point, Transform } from "./geometry/transform";
import { validateCoverage, type InkCoverage } from "./ink/coverage";
export const CANVAS_SIDE = 1600;
export const SHAPE_TYPES = [
  "line",
  "arrow",
  "rectangle",
  "circle",
  "triangle",
  "diamond",
  "star",
  "heart",
] as const;
export type ShapeType = (typeof SHAPE_TYPES)[number];
export type SketchTool = "select" | "pen" | "text" | "shape" | "eraser";
type ElementBase = Readonly<{
  id: string;
  color: string;
  transform: Transform;
}>;
export type StrokeElement = ElementBase &
  Readonly<{ kind: "stroke"; points: Float64Array; strokeWidth: number }>;
export type ShapeElement = ElementBase &
  Readonly<{
    kind: "shape";
    shapeType: ShapeType;
    start: Point;
    end: Point;
    strokeWidth: number;
  }>;
export type InkElement = ElementBase &
  Readonly<{ kind: "ink"; coverage: InkCoverage; resizeMode: "none" | "free" }>;
export type TextElement = ElementBase &
  Readonly<{
    kind: "text";
    text: string;
    boxWidth: number;
    fontSize: number;
    lineHeight: number;
  }>;
export type SketchElement =
  | StrokeElement
  | ShapeElement
  | InkElement
  | TextElement;
export type SketchDocument = Readonly<{
  schemaVersion: 1;
  id: string;
  width: 1600;
  height: 1600;
  background: "#FFFFFF";
  elements: readonly SketchElement[];
}>;
export const PRESET_COLORS = [
  "#000000",
  "#6B7280",
  "#92400E",
  "#DC2626",
  "#F97316",
  "#F59E0B",
  "#16A34A",
  "#0D9488",
  "#06B6D4",
  "#2563EB",
  "#4F46E5",
  "#9333EA",
  "#DB2777",
] as const;
export const createDocument = (id = crypto.randomUUID()): SketchDocument =>
  Object.freeze({
    schemaVersion: 1,
    id,
    width: 1600,
    height: 1600,
    background: "#FFFFFF",
    elements: Object.freeze([]),
  });
const validNumber = (n: number) => Number.isFinite(n) && Math.abs(n) <= 1e9;
const positive = (n: number) => validNumber(n) && n > 0;
function assert(condition: unknown): asserts condition {
  if (!condition) throw new Error("SKETCH_INVALID_SOURCE");
}
function keys(value: object, allowed: readonly string[]) {
  assert(Object.keys(value).every((key) => allowed.includes(key)));
}
export function validateDocument(doc: SketchDocument): void {
  assert(
    doc &&
      doc.schemaVersion === 1 &&
      doc.width === 1600 &&
      doc.height === 1600 &&
      doc.background === "#FFFFFF" &&
      typeof doc.id === "string" &&
      doc.id.length > 0,
  );
  keys(doc, [
    "schemaVersion",
    "id",
    "width",
    "height",
    "background",
    "elements",
  ]);
  assert(Array.isArray(doc.elements) && doc.elements.length <= 1000);
  const ids = new Set<string>();
  for (const element of doc.elements) {
    assert(
      element &&
        typeof element.id === "string" &&
        element.id.length &&
        !ids.has(element.id),
    );
    ids.add(element.id);
    assert(/^#[0-9a-f]{6}$/i.test(element.color));
    const t = element.transform;
    assert(
      t &&
        validNumber(t.x) &&
        validNumber(t.y) &&
        positive(t.scaleX) &&
        positive(t.scaleY),
    );
    keys(t, ["x", "y", "scaleX", "scaleY"]);
    const base = ["id", "kind", "color", "transform"];
    switch (element.kind) {
      case "stroke":
        keys(element, [...base, "points", "strokeWidth"]);
        assert(
          t.scaleX === 1 &&
            t.scaleY === 1 &&
            element.points instanceof Float64Array &&
            element.points.length >= 2 &&
            element.points.length % 2 === 0 &&
            element.points.every(validNumber),
        );
        assert(element.strokeWidth >= 1 && element.strokeWidth <= 48);
        break;
      case "shape":
        keys(element, [...base, "shapeType", "start", "end", "strokeWidth"]);
        assert(
          SHAPE_TYPES.includes(element.shapeType) &&
            element.start &&
            element.end &&
            [
              element.start.x,
              element.start.y,
              element.end.x,
              element.end.y,
            ].every(validNumber),
        );
        keys(element.start, ["x", "y"]);
        keys(element.end, ["x", "y"]);
        assert(element.strokeWidth >= 1 && element.strokeWidth <= 48);
        break;
      case "ink":
        keys(element, [...base, "coverage", "resizeMode"]);
        assert(
          element.resizeMode === "free" ||
            (element.resizeMode === "none" && t.scaleX === 1 && t.scaleY === 1),
        );
        validateCoverage(element.coverage);
        break;
      case "text":
        keys(element, [...base, "text", "boxWidth", "fontSize", "lineHeight"]);
        assert(
          typeof element.text === "string" &&
            element.text.trim() &&
            positive(element.boxWidth) &&
            positive(element.fontSize) &&
            positive(element.lineHeight) &&
            t.scaleX === t.scaleY,
        );
        assert(
          element.fontSize * t.scaleX >= 8 &&
            element.fontSize * t.scaleX <= 512,
        );
        break;
      default:
        throw new Error("SKETCH_INVALID_SOURCE");
    }
  }
}
export function valueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
    if (a.constructor !== b.constructor || a.byteLength !== b.byteLength)
      return false;
    const aa = new Uint8Array(a.buffer, a.byteOffset, a.byteLength),
      bb = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    return aa.every((value, i) => value === bb[i]);
  }
  const aa = a as Record<string, unknown>,
    bb = b as Record<string, unknown>;
  const names = Object.keys(aa).filter(
    (key) => key !== "id" || !("rowIndex" in aa),
  );
  return (
    names.length ===
      Object.keys(bb).filter((key) => key !== "id" || !("rowIndex" in bb))
        .length && names.every((key) => valueEqual(aa[key], bb[key]))
  );
}
export const sameDocument = (a: SketchDocument, b: SketchDocument) =>
  valueEqual(a, b);
