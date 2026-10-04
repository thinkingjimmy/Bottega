/**
 * [INPUT]: Depends on shared AgentWorkspaceScope
 * [OUTPUT]: Provides COMPOSER_DRAFTS_CHANNEL, BLANK_DRAFT_PREFIX, the durable composer draft DTOs (F-12) and ComposerDraftsBridgeApi
 * [POS]: Shared wire contract between the renderer's composer store and main's durable draft owner; file chips cross it as grant refs only, never paths
 */
import type { AgentWorkspaceScope } from "../ipc/agent/agent-ipc";

export const COMPOSER_DRAFTS_CHANNEL = {
  load: "composer-drafts:load",
  save: "composer-drafts:save",
} as const;

/** The blank page's draft is keyed `blank.<Project id or none>` instead of a Chat id (its slot id is new every launch); main window only. */
export const BLANK_DRAFT_PREFIX = "blank.";

export type DurableUnavailable = Readonly<{ id: string; name: string }>;

export type DurableQueueItem = Readonly<{
  id: string;
  /** Rich nodes; a file node's `ref` is a live grant on save and a fresh grant on load. */
  richValue: unknown;
  displayText: string;
  /** Image attachments are kept as names only (references-only ruling): a restored item that had one comes back held. */
  imageNames?: readonly string[];
  content?: unknown;
  custodyIntentId?: string;
  outboxRef?: string;
  state: "queued" | "ambiguous";
  unavailableAttachment?: string;
  createdAt: number;
}>;

export type DurableComposerDraft = Readonly<{
  richValue: unknown;
  /** Draft image names (references only) plus rows already unavailable. */
  unavailableAttachments: readonly DurableUnavailable[];
  queue: Readonly<{ paused: boolean; items: readonly DurableQueueItem[] }>;
  pendingAcks: readonly Readonly<{ kind: "manual" | "steer"; id: string }>[];
  workspaceIdentityKey: string;
  projectId: string | null;
}>;

export type ComposerDraftKey = Readonly<{ chatId: string; incarnationId: string }>;

export type SaveComposerDraftInput = ComposerDraftKey & Readonly<{
  baseRevision: number;
  /** null: the draft and queue are empty, so the durable copy is deleted. */
  draft: DurableComposerDraft | null;
  /** The scope each file chip was granted under, keyed by grant ref, so main can grant it again on restore. */
  fileScopes: Readonly<Record<string, AgentWorkspaceScope>>;
}>;

export type LoadedComposerDraft = Readonly<{
  revision: number;
  draft: DurableComposerDraft | null;
}>;

export type ComposerDraftsBridgeApi = Readonly<{
  load(key: ComposerDraftKey): Promise<LoadedComposerDraft>;
  save(input: SaveComposerDraftInput): Promise<{ revision: number }>;
}>;
