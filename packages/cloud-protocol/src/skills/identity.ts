/**
 * [INPUT]: Depends on Unicode NFKC normalization and the fixed ASCII Skill slug and folder-object grammars.
 * [OUTPUT]: Provides immutable version-one slug normalization, keyed identity input bytes and the Skill object identifier.
 * [POS]: Shared identity boundary; names and plain slug hashes never enter server metadata.
 */
import { z } from "zod";
const SKILL_SLUG_VERSION = 1 as const;
export const skillSlugSchema = z.string().max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
/* Library and generation identifiers name directories in the user's Bottega
   folder. The generic business alphabet also admits `.` and `:`, which no
   folder object may carry, so the service must refuse what the client cannot store. */
export const skillObjectIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
export function normalizeSkillSlug(value: string) { return skillSlugSchema.parse(value.normalize("NFKC").trim().toLowerCase()); }
export function skillSlugIdentityBytes(normalizedSlug: string) {
  return new TextEncoder().encode(JSON.stringify(["bottega-skill-slug", SKILL_SLUG_VERSION, skillSlugSchema.parse(normalizedSlug)]));
}
