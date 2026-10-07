/**
 * [INPUT]: Five branch locale leaves and closed operation failure codes.
 * [OUTPUT]: BranchCopy, branchCopy and localized branch errors.
 * [POS]: Shared branch presentation copy without host i18n dependencies.
 */
import { branchEn } from "./en";
import { branchZhCn } from "./zh-cn";
import { branchJa } from "./ja";
import { branchFr } from "./fr";
import { branchEs } from "./es";
export type BranchCopy = typeof branchEn;
export { branchEn };
export const branchCopy = (locale: string): BranchCopy => locale.toLowerCase().startsWith("zh") ? branchZhCn : locale.startsWith("ja") ? branchJa : locale.startsWith("fr") ? branchFr : locale.startsWith("es") ? branchEs : branchEn;
export function branchError(error: unknown, copy: BranchCopy, fallback: string): string {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : error instanceof Error ? error.message : "";
  const messages: Record<string, string> = {
    "project-git-unavailable": copy.unavailable, "remote-offline": copy.offline, "project-git-changed": copy.changed,
    "project-git-busy": copy.busy, "project-git-invalid-name": copy.invalidName, "project-git-exists": copy.exists,
    "project-git-missing": copy.missing, "project-git-checkout-failed": copy.checkoutConflict,
    "project-git-create-failed": copy.createError, "project-git-budget": copy.budget, "remote-unknown": copy.unknown,
  };
  return messages[code] ?? fallback;
}
