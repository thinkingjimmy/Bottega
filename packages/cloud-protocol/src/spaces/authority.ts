/**
 * [INPUT]: Current deployment protocol headers and immutable original crypto-space identities.
 * [OUTPUT]: Required encrypted business headers shared by every ciphertext domain.
 * [POS]: Keeps current account authorization separate from restored original crypto scope.
 */
import { z } from "zod";
import { protocolHeaderSchema } from "../config";
import { cryptoScopeSchema } from "./model";
export const encryptedSpaceSchema = z.object({ scope: cryptoScopeSchema, keyPackageFingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const encryptedBusinessHeaderSchema = protocolHeaderSchema.extend({ expectedUserId: z.string().min(1).max(128), encryptedSpace: encryptedSpaceSchema }).strict();
export type EncryptedSpace = z.infer<typeof encryptedSpaceSchema>;
export type EncryptedBusinessHeader = z.infer<typeof encryptedBusinessHeaderSchema>;
