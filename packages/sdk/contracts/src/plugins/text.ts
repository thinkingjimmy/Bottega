/**
 * [INPUT]: Depends on Zod.
 * [OUTPUT]: Provides localizedTextSchema / LocalizedText: a copy key the renderer translates (built-in plugins), or verbatim text (what a
 *           host package wrote), and isCopyKey.
 * [POS]: The one text shape every plugin view, detail, impact and settings field uses, so five-language copy never travels as data.
 */
import { z } from "zod";

export const localizedTextSchema = z.union([
  z.object({ key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)*$/).max(160),
    params: z.record(z.string().max(40), z.union([z.string().max(512), z.number().finite()])).optional() }).strict(),
  z.object({ text: z.string().min(1).max(512) }).strict(),
]);
export type LocalizedText = z.infer<typeof localizedTextSchema>;
export const isCopyKey = (value: LocalizedText): value is Extract<LocalizedText, { key: string }> => "key" in value;
