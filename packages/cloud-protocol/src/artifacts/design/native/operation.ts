/**
 * [INPUT]: Original native acceptance/rollback command identity and bounded shared identifiers.
 * [OUTPUT]: Closed immutable original-operation references without new view, generation, owner or filesystem authority.
 * [POS]: Prepared native recovery contract; current read consumers may query an existing durable intent, never admit a new mutation.
 */
import { z } from "zod";
import { designId, digestSchema } from "../reference/identifiers";
const common = { artifactId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), documentId: designId, requestId: z.string().min(1).max(128),
  expectedRevision: z.number().int().positive(), readSetDigest: digestSchema };
export const nativeOperationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("native-candidate-accept"), ...common, candidateId: z.string().uuid(), candidateDigest: digestSchema }).strict(),
  z.object({ action: z.literal("native-ai-rollback"), ...common, rollbackOf: z.string().min(1).max(128) }).strict(),
]);
export function nativeOperationReference(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("The original native operation is missing");
  const raw = input as Record<string, unknown>;
  const keys = ["action", ...Object.keys(common), ...(raw.action === "native-candidate-accept" ? ["candidateId", "candidateDigest"] : ["rollbackOf"])];
  return Object.freeze(nativeOperationSchema.parse(Object.fromEntries(keys.map(key => [key, raw[key]]))));
}
export type NativeOperationReference = z.infer<typeof nativeOperationSchema>;
