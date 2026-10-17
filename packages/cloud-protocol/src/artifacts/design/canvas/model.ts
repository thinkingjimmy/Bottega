/**
 * [INPUT]: Zod and fixed source identifiers; no browser or filesystem authority.
 * [OUTPUT]: Closed Canvas pages, objects, literal typography, geometry and resource identities.
 * [POS]: Canvas document truth shared by main, desktop and Web.
 */
import { z } from "zod";
import { designId, digestSchema, artifactIdSchema } from "../reference/identifiers";
import { sourcePath } from "../reference/path";

export const CANVAS_LIMITS = Object.freeze({ pages: 16, objects: 256, operations: 32, points: 256,
  operationBytes: 6 * 1024, commandBytes: 8 * 1024, imageBytes: 2 * 1024 * 1024, resourceBytes: 50_000_000 });
export const CANVAS_SYSTEM_FONTS = ["system-ui", "sans-serif", "serif", "monospace", "Arial", "Helvetica", "Georgia", "Times New Roman", "Courier New"] as const;
export const DESIGN_PROPERTIES = ["text", "color", "background-color", "font-size", "padding", "gap", "width", "height",
  "font-family", "font-weight", "font-style", "text-decoration", "text-align", "line-height", "letter-spacing", "left", "top"] as const;
export const literalColorSchema = z.string().max(128).regex(/^(?:#[a-f0-9]{3}(?:[a-f0-9])?|#[a-f0-9]{6}(?:[a-f0-9]{2})?|(?:rgba?|hsla?|oklch)\([\d.,%\s/+-]+\)|transparent|currentColor)$/i)
  .refine(value => {
    if (!value.includes("(")) return true;
    const channels = value.slice(value.indexOf("(") + 1, -1).trim().split(/[\s,/]+/);
    return [3, 4].includes(channels.length) && channels.every(value => /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)%?$/.test(value) && Number.isFinite(parseFloat(value)));
  });
const number = z.number().finite().min(-100000).max(100000);
export const canvasPositionSchema = z.object({ x: number, y: number }).strict();
export const canvasBoundsSchema = canvasPositionSchema.extend({ width: z.number().finite().positive().max(8000), height: z.number().finite().positive().max(8000) }).strict();
export const canvasPageSchema = z.object({ id: designId, title: z.string().trim().min(1).max(250) }).strict();
export function implicitCanvasPageId(manifest: { boards: { id: string }[]; objects?: { id: string }[] }) {
  const ids = new Set([...manifest.boards, ...(manifest.objects ?? [])].map(value => value.id));
  let id = "page-1", number = 1; while (ids.has(id)) id = "page-1-" + (++number); return id;
}
const literalLength = z.string().max(128).regex(/^(?:0|auto|(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%))(?:\s+(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%))){0,3}$/)
  .refine(value => !(value.match(/[\d.]+/g) ?? []).some(value => Number(value) > 8000));
const singleLength = literalLength.refine(value => !value.includes(" ") && value !== "auto");
export const fontFamilySchema = z.string().min(1).max(200).regex(/^[a-z\d _,"'-]+$/i)
  .refine(value => (value.match(/"/g)?.length ?? 0) % 2 === 0 && (value.match(/'/g)?.length ?? 0) % 2 === 0);
export const canvasStyleSchema = z.object({ color: literalColorSchema.optional(), "background-color": literalColorSchema.optional(),
  "font-family": fontFamilySchema.optional(), "font-size": singleLength.optional(),
  "font-weight": z.string().regex(/^(?:normal|bold|[1-9]\d{0,2}|1000)$/).optional(),
  "font-style": z.enum(["normal", "italic", "oblique"]).optional(),
  "text-decoration": z.enum(["none", "underline", "line-through", "underline line-through"]).optional(),
  "text-align": z.enum(["left", "center", "right", "justify", "start", "end"]).optional(),
  "line-height": z.string().max(32).refine(value => value === "normal" || /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) && Number(value) > 0 && Number(value) <= 10 || singleLength.safeParse(value).success).optional(),
  "letter-spacing": z.string().max(32).regex(/^(?:normal|0|-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em))$/).refine(value => Math.abs(parseFloat(value)) <= 8000 || value === "normal").optional(),
}).strict();
export const designPropertySchema = z.enum(DESIGN_PROPERTIES);
export function validDesignProperty(property: string, value: string) {
  if (property === "text") return value.length <= 4096;
  const style = canvasStyleSchema.shape[property as keyof typeof canvasStyleSchema.shape];
  if (style) return style.safeParse(value).success;
  if (property === "left" || property === "top") return /^-?(?:\d+(?:\.\d+)?|\.\d+)px$/.test(value) && Math.abs(parseFloat(value)) <= 8000;
  return ["padding", "gap", "width", "height"].includes(property) && literalLength.safeParse(value).success;
}
// Links remain document-local because the offline frame cannot navigate to remote origins.
export const canvasLinkSchema = z.string().min(1).max(240).refine(value => /^#[a-z\d_-]+$/i.test(value) ||
  !/^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(value) && !/[<>"'\s]/.test(value) && sourcePath.safeParse(value.split("#")[0]!.replace(/^(?:\.\.\/){1,3}/, "")).success);
export const canvasAssetSchema = z.object({ path: sourcePath, digest: digestSchema }).strict();
export const canvasImageSourceSchema = z.discriminatedUnion("kind", [
  canvasAssetSchema.extend({ kind: z.literal("document") }).strict(),
  z.object({ kind: z.literal("artifact"), artifactId: artifactIdSchema, digest: digestSchema }).strict(),
]);
const common = { bounds: canvasBoundsSchema, style: canvasStyleSchema.optional() };
const text = { text: z.string().max(4096), href: canvasLinkSchema.nullable().optional(), list: z.enum(["none", "ordered", "unordered"]).optional() };
const shape = { fill: literalColorSchema, stroke: literalColorSchema, strokeWidth: z.number().finite().min(0).max(128) };
export const canvasPointsSchema = z.array(z.object({ x: z.number().finite().min(0).max(1), y: z.number().finite().min(0).max(1) }).strict()).min(2).max(CANVAS_LIMITS.points);
const variants = [
  z.object({ ...common, kind: z.literal("text"), ...text }).strict(),
  z.object({ ...common, kind: z.literal("note"), text: text.text }).strict(),
  z.object({ ...common, kind: z.literal("rectangle"), ...shape }).strict(),
  z.object({ ...common, kind: z.literal("ellipse"), ...shape }).strict(),
  z.object({ ...common, kind: z.literal("line"), ...shape, points: canvasPointsSchema.refine(value => value.length === 2).optional() }).strict(),
  z.object({ ...common, kind: z.literal("arrow"), ...shape, points: canvasPointsSchema.refine(value => value.length === 2).optional() }).strict(),
  z.object({ ...common, kind: z.literal("drawing"), ...shape, points: canvasPointsSchema }).strict(),
  z.object({ ...common, kind: z.literal("image"), asset: canvasAssetSchema, alt: z.string().max(250) }).strict(),
] as const;
export const canvasObjectInputSchema = z.discriminatedUnion("kind", variants);
const identity = { id: designId, pageId: designId, boardId: designId.optional() };
export const savedCanvasObjectSchema = z.discriminatedUnion("kind", [variants[0].extend(identity), variants[1].extend(identity),
  variants[2].extend(identity), variants[3].extend(identity), variants[4].extend(identity), variants[5].extend(identity),
  variants[6].extend(identity), variants[7].extend(identity)]);
export const canvasObjectSchema = savedCanvasObjectSchema;
export const canvasObjectChangesSchema = z.object({ bounds: canvasBoundsSchema.optional(), style: canvasStyleSchema.optional(),
  text: text.text.optional(), href: text.href, list: text.list, fill: shape.fill.optional(), stroke: shape.stroke.optional(),
  strokeWidth: shape.strokeWidth.optional(), points: canvasPointsSchema.optional(), alt: z.string().max(250).optional(),
}).strict().refine(value => Object.keys(value).length > 0, "Specify a changed object field");
export type CanvasPage = z.infer<typeof canvasPageSchema>;
export type CanvasObject = z.infer<typeof savedCanvasObjectSchema>;
export type CanvasObjectInput = z.infer<typeof canvasObjectInputSchema>;
export type CanvasStyle = z.infer<typeof canvasStyleSchema>;
