/**
 * [INPUT]: Zod and closed source/digest identifiers.
 * [OUTPUT]: Native comment/selection evidence with immutable source identity and explicit user instruction.
 * [POS]: Inert original-Chat evidence; only a formal main-admitted edit can obtain execution authority.
 */
import { z } from "zod";
import { digestSchema } from "../reference/identifiers";
import { sourcePath } from "../reference/path";
export const nativeTargetHintSchema = z.object({ anchor: z.string().min(1).max(2048), label: z.string().min(1).max(1000), file: sourcePath.optional(), section: z.string().max(200).optional() }).strict();
const common = { anchor: z.string().min(1).max(2048), label: z.string().min(1).max(1000), file: sourcePath.optional(), section: z.string().max(200).optional(),
  sourceDigest: digestSchema, text: z.string().trim().min(1).max(10000) };
export const nativeEditEvidenceSchema = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("native-comment"), commentId: z.string().min(1).max(128), commentDigest: digestSchema }).strict(),
  z.object({ ...common, kind: z.literal("native-selection") }).strict(),
]);
export type NativeEditEvidence = z.infer<typeof nativeEditEvidenceSchema>;
