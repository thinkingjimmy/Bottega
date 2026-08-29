/**
 * [INPUT]: Depends only on untrusted Skill author names
 * [OUTPUT]: Provides the single SkillSlug admission rule and structured rejection facts
 * [POS]: Identity gate shared by library, extension, project, and system sources before dedupe, prompt rendering, or lease issuance
 */

export const SKILL_SLUG_MAX_LENGTH = 64;
export const SKILL_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type SkillSlug = string & { readonly __skillSlug: unique symbol };

export type SkillSlugAdmission =
  | Readonly<{ ok: true; slug: SkillSlug }>
  | Readonly<{
      ok: false;
      code: "invalid-name";
      value: string;
      reason: "empty" | "too-long" | "format";
    }>;

export function admitSkillSlug(value: string): SkillSlugAdmission {
  if (!value) return { ok: false, code: "invalid-name", value, reason: "empty" };
  if ([...value].length > SKILL_SLUG_MAX_LENGTH) {
    return { ok: false, code: "invalid-name", value, reason: "too-long" };
  }
  if (!SKILL_SLUG_PATTERN.test(value)) {
    return { ok: false, code: "invalid-name", value, reason: "format" };
  }
  return { ok: true, slug: value as SkillSlug };
}
