/**
 * [INPUT]: Existing workspace commands and the main-owned fixed revision contract.
 * [OUTPUT]: Bounded design-system form/checkpoint and paged difference reader types.
 * [POS]: Trusted host inputs; this is neither a registry nor a comments database.
 */
import type { DesignCheckpoint } from "@ai-chat/cloud-protocol/artifacts/design/review";
export type SystemDraft = NonNullable<DesignCheckpoint["system"]>;
export type SystemCommand = NonNullable<SystemDraft["request"]>;
export type DifferencePage = { status: "difference"; sourceDigest: string; total: number; cursor: number; nextCursor: number | null;
  changes: { key: string; family: "token" | "alias" | "component"; kind: "added" | "changed" | "removed" | "conflict";
    requiresDecision: boolean; base: string | null; current: string | null; incoming: string | null }[];
  unsynced: { path: string; kind: string; name?: string; reason: string }[]; unsyncedTotal: number; unsyncedCursor: number; nextUnsyncedCursor: number | null };
export const emptySystemDraft = (): SystemDraft => ({ token: "", theme: "light", value: "", sourcesText: "", decisions: {} });
