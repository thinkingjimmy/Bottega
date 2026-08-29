/**
 * [INPUT]: Depends on shared Library-first Skills reason/candidate contracts and renderer i18n/error values
 * [OUTPUT]: Provides candidate actionability, stable reason/error copy lookup, and compact byte formatting
 * [POS]: Pure renderer text adapter for the Skills page and import dialog
 */

import type {
  ManagedSkillCandidate,
  ManagedSkillReason,
} from "../../../../shared/unified-skills-ipc";

export const actionableCandidate = (candidate: ManagedSkillCandidate) =>
  candidate.importable && ["new", "update"].includes(candidate.status);

export function skillReasonText(
  t: (key: string, values?: Record<string, unknown>) => string,
  reason: ManagedSkillReason
) {
  const key = `settings.skills.reason.${reason.code}`;
  const translated = t(key);
  return translated === key ? t("settings.skills.reason.unknown") : translated;
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
