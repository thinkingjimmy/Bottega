/**
 * [INPUT]: Original Home semantic identities and exact encrypted transports.
 * [OUTPUT]: Closed frozen entry/manifest/page records for the existing Chat outbox.
 * [POS]: Ciphertext custody model only; introduces no scheduler or persistence owner.
 */
import { z } from "zod";
import { sha256Schema as hash } from "../../../blobs";
import { encryptedSpaceSchema } from "../../../spaces";
import { homeCipherIdentitySchema, encryptedHomeEntrySchema, encryptedHomeManifestSchema, encryptedHomePageSchema } from "./model";
const fields = { plaintextHash: hash, encryptedSpace: encryptedSpaceSchema };
export const frozenHomeEntrySchema = z.object({ kind: z.literal("encrypted-home-entry"), ...fields,
  identity: homeCipherIdentitySchema, entry: encryptedHomeEntrySchema }).strict();
export const frozenHomeManifestSchema = z.object({ kind: z.literal("encrypted-home-manifest"), ...fields, manifest: encryptedHomeManifestSchema }).strict();
export const frozenHomePageSchema = z.object({ kind: z.literal("encrypted-home-page"), ...fields, operation: encryptedHomePageSchema }).strict();
export const frozenHomeRecords = [frozenHomeEntrySchema, frozenHomeManifestSchema, frozenHomePageSchema] as const;
export type FrozenHomeEntry = z.infer<typeof frozenHomeEntrySchema>;
export type FrozenHomeManifest = z.infer<typeof frozenHomeManifestSchema>;
export type FrozenHomePage = z.infer<typeof frozenHomePageSchema>;
