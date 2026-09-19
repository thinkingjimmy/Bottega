/**
 * [INPUT]: Encrypted Base RPCs and the existing client-only native operation/receipt schemas.
 * [OUTPUT]: Sole ciphertext Base registry plus local native JSON codecs that preserve plaintext operation hashes.
 * [POS]: Network contracts have no plaintext alternative; semantic codecs never call a public RPC.
 */
import { z } from "zod";
import { protocolHeaderSchema, CLOUD_LIMITS } from "../config";
import { baseOperationSchema, baseReceiptSchema, canonicalJson, type BaseOperation } from "./operations";
import { encryptedBaseFunctions, encryptedBaseCatalogItemSchema } from "./encrypted/functions";
export const businessHeaderSchema = protocolHeaderSchema.extend({ expectedUserId: z.string().min(1).max(128) }).strict();
export const baseFunctions = encryptedBaseFunctions;
export const baseCatalogItemSchema = encryptedBaseCatalogItemSchema;
function boundedNativeJson(input: string, limit: number) {
  if (new TextEncoder().encode(input).byteLength > limit) throw new Error("Payload exceeds its byte budget"); return input;
}
export const encodeBaseOperation = (input: BaseOperation) => boundedNativeJson(canonicalJson(baseOperationSchema.parse(input)), CLOUD_LIMITS.maxOperationBytes);
export const decodeBaseReceipt = (input: string) => baseReceiptSchema.parse(JSON.parse(boundedNativeJson(input, CLOUD_LIMITS.maxPageBytes)));
