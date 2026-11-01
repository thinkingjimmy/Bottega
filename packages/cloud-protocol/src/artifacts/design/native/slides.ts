/**
 * [INPUT]: Complete immutable native deck v4/section source, fixed system bindings and inert section validation.
 * [OUTPUT]: Complete ordered Slides host metadata with a cover and explicit bounded source capacity.
 * [POS]: Native Slides format adapter; host metadata never replaces or rewrites deck.json or sections.
 */
import { z } from "zod";
import { systemBindingSchema, type DesignManifest } from "../model";
import { sourcePath } from "../reference/path";
import { nativeSourceId } from "./identity";
import { validateSlideSection } from "./section";
export const NATIVE_SLIDES_LIMITS = Object.freeze({ slides: 256, files: 512, source: 32 * 1024 * 1024, index: 64 * 1024 });
const id = z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/).refine(value => !["__proto__", "prototype", "constructor"].includes(value));
const face = z.object({ family: z.string().trim().min(1).max(128),
  src: z.union([sourcePath, z.string().regex(/^\/_blob\/[a-f0-9]{32}$/)]).optional(),
  href: z.string().max(2048).url().refine(value => { const url = new URL(value); return url.protocol === "https:" && url.hostname === "fonts.googleapis.com" && !url.username && !url.password; }).optional(),
}).passthrough().refine(value => Boolean(value.src) !== Boolean(value.href), "A font must have exactly one source");
const deckSchema = z.object({ v: z.literal(4), title: z.string().max(250), order: z.array(id).min(1).max(NATIVE_SLIDES_LIMITS.slides), cover: id.optional(),
  createdOnFiles: z.object({ v: z.literal(1), at: z.string().datetime({ offset: true, precision: 0 }) }).strict().optional(), lists: z.literal("css").optional(),
  sections: z.record(z.string().max(128), z.object({ description: z.string().max(2500), start: id }).passthrough()).refine(value => Object.keys(value).length <= 256).default({}),
  faces: z.record(z.string().max(128), face).refine(value => Object.keys(value).length <= 4).default({}),
  designSystems: z.array(z.record(z.string(), z.unknown())).max(8).default([]), bottegaSystems: z.array(systemBindingSchema).max(8).optional(),
}).passthrough();
export function projectSlidesManifest(files: readonly { path: string; data: Uint8Array }[], documentId: string): DesignManifest {
  const entry = files.find(file => file.path === "deck.json");
  if (!entry || entry.data.length > NATIVE_SLIDES_LIMITS.index) throw new Error("Native deck is missing or exceeds its 64 KiB index budget");
  if (files.length > NATIVE_SLIDES_LIMITS.files || files.reduce((sum, file) => sum + file.data.length, 0) > NATIVE_SLIDES_LIMITS.source)
    throw new Error("Native Slides exceeds its 512-file or 32 MiB source budget");
  const index = deckSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(entry.data)));
  const ordered = new Set(index.order), sources = new Map(files.map(file => [file.path, file.data]));
  if (ordered.size !== index.order.length || sources.size !== files.length) throw new Error("Native slide IDs and source paths must be unique");
  if (index.cover && !ordered.has(index.cover) || Object.values(index.sections).some(section => !ordered.has(section.start)))
    throw new Error("Native cover and sections must refer to indexed slides");
  for (const path of sources.keys()) if (/^slides\/[^/]+\.html$/.test(path) && !ordered.has(path.slice(7, -5)))
    throw new Error("Native slide source is absent from its deck index");
  const boards = index.order.map(id => {
    const path = "slides/" + id + ".html", data = sources.get(path);
    if (!data) throw new Error("Indexed native slide source is missing: " + path);
    return { id: nativeSourceId("b-", path), file: path, title: validateSlideSection(data, id), mode: "fixed" as const, viewport: { width: 1920, height: 1080 } };
  });
  return { schemaVersion: 1, format: "bottega-design", contentFormat: "slides/v4", documentId, title: index.title.trim() || documentId,
    boards, launchBoard: nativeSourceId("b-", "slides/" + (index.cover ?? index.order[0]) + ".html"), ...(index.bottegaSystems ? { systems: index.bottegaSystems } : {}) };
}
