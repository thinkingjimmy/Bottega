/**
 * [INPUT]: Depends on the fixed key-package byte budget and Zod's closed scalar contracts.
 * [OUTPUT]: Provides immutable encrypted-space descriptors, create receipts and fixed per-device create/account receipt limits.
 * [POS]: Server-safe space identity; source crypto scope is distinct from current authorization.
 */
import { z } from "zod";
import { MAX_KEY_PACKAGE_BYTES } from "../encryption/limits";
export const SPACE_LIMITS = Object.freeze({ windowMs: 60_000, createsPerDevice: 5, receiptsPerAccount: 32 });
const opaqueId = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
export const cryptoScopeSchema = z.object({ sourceEnvironment: opaqueId, sourceAccountId: opaqueId, vaultId: opaqueId, keyId: opaqueId }).strict();
export const keyPackageSchema = z.string().min(1).max(Math.ceil(MAX_KEY_PACKAGE_BYTES * 4 / 3)).regex(/^[A-Za-z0-9_-]+$/);
export const spaceDescriptorSchema = z.object({ scope: cryptoScopeSchema, keyPackage: keyPackageSchema,
  keyPackageFingerprint: z.string().regex(/^[a-f0-9]{64}$/), createOperationId: opaqueId,
  createdAt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict();
export const spaceCreateResultSchema = z.object({ disposition: z.enum(["created", "existing"]), space: spaceDescriptorSchema }).strict();
export type SpaceDescriptor = z.infer<typeof spaceDescriptorSchema>;
export type SpaceCreateResult = z.infer<typeof spaceCreateResultSchema>;
