/**
 * [INPUT]: Untrusted native producer choices and the exact source's available page identities/order.
 * [OUTPUT]: Closed deeply frozen native format/range/quality/layout/variant/font-policy defaults.
 * [POS]: Shared export admission; concrete preview authority, source/resource identity and rendering stay with the owner.
 */
import { z } from "zod";
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const confirmation = z.object({ previewId: z.string().uuid(), previewDigest: digest }).strict();
const replacement = z.object({ from: z.string().trim().min(1).max(128).refine(value => !Array.from(value).some(char => char.codePointAt(0)! < 32 || char.codePointAt(0) === 127)),
  to: z.literal("noto-sans-sc-2.004"), digest }).strict();
export const nativeExportFontsSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("strict") }).strict(),
  z.object({ mode: z.literal("replace"), replacements: z.array(replacement).min(1).max(32)
    .refine(values => new Set(values.map(value => value.from.toLowerCase())).size === values.length), confirmation }).strict(),
  z.object({ mode: z.literal("raster"), confirmation }).strict(),
  z.object({ mode: z.literal("basic"), confirmation }).strict(),
]);
const id = z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_-]{0,127}$/);
export const nativeExportOptionsSchema = z.object({ format: z.enum(["html", "png", "pdf", "pptx"]),
  pages: z.array(id).min(1).max(256).optional(), bundle: z.boolean().optional(), scale: z.number().int().min(1).max(4).optional(),
  layout: z.enum(["fixed", "flow"]).optional(), paper: z.enum(["a4", "letter"]).optional(),
  notes: z.boolean().optional(), quality: z.enum(["good", "better", "best"]).optional(),
  variant: z.enum(["current", "basic", "pictures"]).optional(),
  theme: z.boolean().optional(), titlePlaceholders: z.boolean().optional(),
  interactive: z.boolean().optional(), shrinkImages: z.boolean().optional(),
  fonts: nativeExportFontsSchema.optional(),
}).strict();
export type NativeExportInput = z.infer<typeof nativeExportOptionsSchema>;
export type NativeExportContext = { contentFormat: "canvas-dc/v3" | "slides/v4"; pages: readonly string[]; launchPage: string };
const freeze = <T extends object>(value: T): Readonly<T> => {
  for (const child of Object.values(value)) if (child && typeof child === "object") freeze(child);
  return Object.freeze(value);
};
export function normalizeNativeExportOptions(input: unknown, context: NativeExportContext) {
  const value = nativeExportOptionsSchema.parse(input), slides = context.contentFormat === "slides/v4";
  if ((!slides && context.contentFormat !== "canvas-dc/v3") || !context.pages.length || context.pages.length > 256 ||
    new Set(context.pages).size !== context.pages.length || !context.pages.includes(context.launchPage)) throw new Error("Native source page identity is invalid");
  const pages = value.pages ?? (value.format === "png" ? [context.launchPage] : [...context.pages]);
  if (new Set(pages).size !== pages.length || pages.some(id => !context.pages.includes(id))) throw new Error("Choose unique pages from this exact native source");
  const only = (allowed: boolean, keys: readonly (keyof NativeExportInput)[]) => {
    if (!allowed && keys.some(key => value[key] !== undefined)) throw new Error("An export option is not applicable to this native format");
  };
  only(value.format === "png", ["scale"]);
  only(value.format === "png" || !slides && value.format === "html", ["bundle"]);
  only(!slides && value.format === "pdf", ["paper", "layout"]);
  only(slides && ["pdf", "pptx"].includes(value.format), ["notes"]);
  only(slides && (value.format === "pdf" || value.format === "pptx" && value.variant === "pictures"), ["quality"]);
  only(slides && value.format === "pptx", ["variant", "theme", "titlePlaceholders"]);
  only(value.format === "html", ["interactive"]);
  only(slides && value.format === "html", ["shrinkImages"]);
  if (!slides && value.format === "pptx") throw new Error("Canvas does not provide a native PPTX producer");
  const bundle = value.bundle ?? false;
  if (value.format === "html" && value.interactive === false) throw new Error("Original native HTML preserves interactions; static HTML is not available");
  if (value.format === "html" && bundle && pages.length !== 1) throw new Error("Choose one original artboard for its HTML ZIP");
  if (value.format === "png" && (slides && bundle || pages.length !== 1 && !bundle)) throw new Error("This native PNG range requires one page or an explicit Canvas image bundle");
  const variant = value.format === "pptx" ? value.variant ?? "current" : null;
  const fonts = value.fonts ?? { mode: "strict" as const };
  if (variant === "pictures" && fonts.mode !== "raster" || variant === "basic" && fonts.mode !== "basic")
    throw new Error("Preview and confirm the concrete native font or picture variant before exporting");
  if (fonts.mode === "basic" && variant !== "basic" || fonts.mode === "raster" && value.format === "pptx" && variant !== "pictures")
    throw new Error("The confirmed font preview does not match this native variant");
  if (variant === "pictures" && (value.theme !== undefined || value.titlePlaceholders !== undefined)) throw new Error("Picture PPTX does not provide editable theme or title placeholders");
  const theme = variant && variant !== "pictures" ? value.theme ?? true : null;
  const titles = variant && variant !== "pictures" ? value.titlePlaceholders ?? true : null;
  if (titles && !theme) throw new Error("PPTX title placeholders require its theme");
  return freeze({ schemaVersion: 1 as const, format: value.format, pages: [...pages], bundle, scale: value.scale ?? 1,
    layout: value.layout ?? "fixed", paper: !slides && value.format === "pdf" ? value.paper ?? "a4" : null,
    notes: value.notes ?? (value.format === "pptx"), quality: slides && (value.format === "pdf" || variant === "pictures") ? value.quality ?? "best" : null,
    variant, theme, titlePlaceholders: titles, interactive: value.format === "html" ? value.interactive ?? true : false,
    shrinkImages: value.format === "html" ? value.shrinkImages ?? false : false, fonts });
}
export type NativeExportOptions = ReturnType<typeof normalizeNativeExportOptions>;
