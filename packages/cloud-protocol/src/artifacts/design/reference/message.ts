/**
 * [INPUT]: Bounded inert reference-fence JSON and the strict original design-reference schema.
 * [OUTPUT]: Validated frozen native request/target presentation data.
 * [POS]: Lazy message reader; the owner workspace must independently authorize every navigation.
 */
import { z } from "zod";
import { DESIGN_REFERENCE_MESSAGE_LIMIT } from "@bottega/contracts/model/artifacts/design-message";
import { designReferenceSchema } from "./model";
const schema = z.object({ name: z.string().min(1).max(1000), reference: designReferenceSchema }).strict().refine(value => Boolean(value.reference.native), "A sent native reference requires frozen instructions");
export function decodeDesignReferenceMessage(code: string) {
  if (code.length > DESIGN_REFERENCE_MESSAGE_LIMIT) throw new Error("Design reference message exceeds its presentation budget");
  return schema.parse(JSON.parse(code));
}
