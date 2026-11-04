/**
 * [INPUT]: Workspace commands, archived system validation and exact token/theme resolution.
 * [OUTPUT]: System form/checkpoint types, difference pages and validated selection migration after a commit.
 * [POS]: Trusted host inputs; this is neither a registry nor a comments database.
 */
import { inspectDesignSystem } from "@ai-chat/cloud-protocol/artifacts/design/system/validation";
import { resolvedSystemValue } from "@ai-chat/cloud-protocol/artifacts/design/system/tokens";
import type { DesignCheckpoint } from "@ai-chat/cloud-protocol/artifacts/design/review";
export type SystemDraft = NonNullable<DesignCheckpoint["system"]>;
export type SystemCommand = NonNullable<SystemDraft["request"]>;
export type DifferencePage = { status: "difference"; sourceDigest: string; total: number; cursor: number; nextCursor: number | null;
  changes: { key: string; family: "token" | "alias" | "component"; kind: "added" | "changed" | "removed" | "conflict";
    requiresDecision: boolean; base: string | null; current: string | null; incoming: string | null }[];
  unsynced: { path: string; kind: string; name?: string; reason: string }[]; unsyncedTotal: number; unsyncedCursor: number; nextUnsyncedCursor: number | null };
export const emptySystemDraft = (): SystemDraft => ({ token: "", theme: "light", value: "", sourcesText: "", decisions: {} });

export function committedSystemSelection(raw: unknown, selection: Pick<SystemDraft, "token" | "theme">): SystemDraft | undefined {
  const { system } = inspectDesignSystem(raw);
  if (!system || !system.tokens.themes.some(theme => theme.id === selection.theme)) return;
  const value = resolvedSystemValue(system, selection.token, selection.theme);
  return value === null || value === undefined ? undefined : { ...emptySystemDraft(), token: selection.token, theme: selection.theme, value };
}
