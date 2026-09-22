/**
 * [INPUT]: Depends on Zod, the cloud id/device-name scalars and the machine key.
 * [OUTPUT]: Provides the Bottega folder identity, its account-level ownership record and the typed `library-owned-elsewhere` refusal reader.
 * [POS]: Shared folder-ownership contract between the desktop publisher, the server admission guard and the refusal copy on both surfaces.
 */
import { z } from "zod";
import { cloudIdSchema, deviceNameSchema, machineIdHashSchema } from "./index";

/** `library.json`'s `libraryId`: the folder's own identity, minted locally and never derived from an account. */
export const libraryIdSchema = z.string().uuid();
export const libraryOwnerSchema = z.object({ libraryId: libraryIdSchema, machineIdHash: machineIdHashSchema,
  ownerDeviceId: cloudIdSchema, host: deviceNameSchema, publishedAt: z.number().int().nonnegative() }).strict();
export type CloudLibraryOwner = z.infer<typeof libraryOwnerSchema>;

/* A folder belongs to the computer that published it. The refusal carries the owner's current display name so the
   folder step and the Sync row can say the one sentence the ruling defines without a second lookup. */
export const libraryRefusalSchema = z.object({ kind: z.literal("library-owned-elsewhere"), host: deviceNameSchema }).strict();
export type LibraryRefusal = z.infer<typeof libraryRefusalSchema>;
export function libraryRefusal(error: unknown): LibraryRefusal | null {
  if (!error || typeof error !== "object" || !("data" in error)) return null;
  const result = libraryRefusalSchema.safeParse(error.data);
  return result.success ? result.data : null;
}
