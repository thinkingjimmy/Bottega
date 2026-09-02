/**
 * [INPUT]: Depends on shared Library-first Skills reason/candidate contracts and renderer i18n/error values
 * [OUTPUT]: Provides candidate actionability, stable reason/error copy lookup, and compact byte formatting
 * [POS]: Pure renderer text adapter for the Skills page and import dialog
 */

import type {
  ManagedSkillCandidate,
  ManagedSkillReason,
  ManagedSkillReasonCode,
} from "../../../../shared/unified-skills-ipc";

const SKILL_REASON_KEYS = {
  "missing-skill-md": "settings.skills.reason.missing-skill-md",
  "invalid-frontmatter": "settings.skills.reason.invalid-frontmatter",
  "invalid-name": "settings.skills.reason.invalid-name",
  "skill-md-too-large": "settings.skills.reason.skill-md-too-large",
  "too-many-directories": "settings.skills.reason.too-many-directories",
  "too-many-candidates": "settings.skills.reason.too-many-candidates",
  symlink: "settings.skills.reason.symlink",
  "unsafe-path": "settings.skills.reason.unsafe-path",
  "not-a-directory": "settings.skills.reason.not-a-directory",
  unreadable: "settings.skills.reason.unreadable",
  missing: "settings.skills.reason.missing",
  changed: "settings.skills.reason.changed",
  timeout: "settings.skills.reason.timeout",
  "name-taken": "settings.skills.reason.name-taken",
  "name-taken-same": "settings.skills.reason.name-taken-same",
  "name-taken-differs": "settings.skills.reason.name-taken-differs",
  "source-gone": "settings.skills.reason.source-gone",
  "postcondition-changed": "settings.skills.reason.postcondition-changed",
  "acquisition-failed": "settings.skills.reason.acquisition-failed",
  "ref-invalid": "settings.skills.reason.ref-invalid",
  unknown: "settings.skills.reason.unknown",
} as const satisfies Record<ManagedSkillReasonCode, string>;

export const actionableCandidate = (candidate: ManagedSkillCandidate) =>
  candidate.importable && ["new", "update"].includes(candidate.status);

export function skillReasonText(
  t: (key: string, values?: Record<string, unknown>) => string,
  reason: ManagedSkillReason
) {
  const copyKey = SKILL_REASON_KEYS[reason.code];
  const translated = t(copyKey);
  return translated === copyKey ? t("settings.skills.reason.unknown") : translated;
}

export function skillErrorText(
  t: (key: string, values?: Record<string, unknown>) => string,
  cause: unknown
) {
  const message = cause instanceof Error ? cause.message : "";
  return message || t("settings.skills.error.failed");
}

export function skillBytesText(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
