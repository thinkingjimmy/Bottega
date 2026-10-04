/**
 * [INPUT]: Depends on the per-Chat composer store (entries, store-wide feed, migration custody, pending ACKs), the message-queue model and the
 *          ComposerDraftsBridgeApi (window.composerDrafts)
 * [OUTPUT]: Provides startDurableDrafts (save debounced, a queue change at once, empty deletes; restore into an empty composer, then save what was typed while it loaded; the blank page keyed by Project; a quit's flush that waits for first loads still in flight and says whether every held draft is on disk) and the installed
 *           instance's restoreDurableDraft / flushDurableDrafts
 * Flush drains restores, timers and the save chain to a stable revision before acknowledging persistence.
 * [POS]: lib/chat-composer's F-12 renderer port; main owns the files and the file-grant rules, this owns when to save and how a restore lands
 */

import type { RichValue } from "@ai-chat/ui/components/ai-elements/prompt-input";
import type { AgentWorkspaceScope } from "../../../../shared/ipc/agent/agent-ipc";
import { BLANK_DRAFT_PREFIX, type ComposerDraftsBridgeApi, type DurableComposerDraft, type DurableQueueItem } from "../../../../shared/composer/drafts-ipc";
import {
  composerMigrating, pendingComposerAcks, readComposer, readComposerEntries, readDraftChatId, registerPendingComposerAck, subscribeAllComposers,
  subscribeDraftChatId, updateComposer,
  type ComposerState,
} from "../../chat/state/composer/chat-composer-store";
import type { QueueItem } from "../../chat/session/message-queue-model";

type TimerPorts = Readonly<{ setTimer(run: () => void, ms: number): unknown; clearTimer(handle: unknown): void }>;
export type DurableDraftPorts = Readonly<{ bridge: ComposerDraftsBridgeApi; debounceMs?: number }> & Partial<TimerPorts>;

const keyOf = (chatId: string, incarnationId: string) => `${chatId}\u0000${incarnationId}`;
type FileNode = Extract<RichValue[number], { type: "file" }>;

/* The durable projection: file chips carry their current grant and scope; images are names only (references-only ruling). */
function toDurable(state: ComposerState, chatId: string, blank = false) {
  const fileScopes: Record<string, AgentWorkspaceScope> = {};
  const withGrants = (value: RichValue) => value.map((node) => {
    if (node.type !== "file") return node;
    const resource = state.fileResources.get(node.id);
    const ref = resource?.node.ref ?? node.ref;
    // The blank page's slot Chat won't exist after a relaunch, so its chips can't be granted again under it: they come back unavailable.
    if (resource?.scope && !(blank && resource.scope.kind === "conversation")) fileScopes[ref] = resource.scope;
    return { ...node, ref } satisfies FileNode;
  });
  const unavailableAttachments = [...state.unavailableAttachments, ...state.draft.files.map((file) => ({ id: file.id, name: file.filename ?? "image" }))];
  const items: DurableQueueItem[] = state.queue.items.map((item) => ({
    id: item.id,
    richValue: withGrants(item.prompt.richValue),
    displayText: item.prompt.displayText,
    ...(item.prompt.attachments.length ? { imageNames: item.prompt.attachments.map((attachment) => attachment.name) } : {}),
    ...(item.content ? { content: item.content } : {}),
    ...(item.custodyIntentId ? { custodyIntentId: item.custodyIntentId } : {}),
    ...(item.outboxRef ? { outboxRef: item.outboxRef } : {}),
    // A send in flight when the app died is unknown on return: shown, never re-sent by itself.
    state: item.state === "queued" ? "queued" : "ambiguous",
    ...(item.unavailableAttachment ? { unavailableAttachment: item.unavailableAttachment } : {}),
    createdAt: item.createdAt,
  }));
  const richValue = withGrants(state.draft.richValue);
  const empty = !richValue.some((node) => node.type !== "text" || node.value.trim()) && !unavailableAttachments.length && !items.length;
  const draft: DurableComposerDraft | null = empty ? null : {
    richValue, unavailableAttachments, queue: { paused: state.queue.paused, items },
    pendingAcks: pendingComposerAcks().filter((ack) => ack.chatId === chatId).map(({ kind, id }) => ({ kind, id })),
    workspaceIdentityKey: state.workspaceIdentityKey, projectId: state.projectId,
  };
  return { draft, fileScopes };
}

const queueSignature = (state: ComposerState) =>
  JSON.stringify([state.queue.paused, state.queue.items.map((item) => [item.id, item.state, item.unavailableAttachment ?? ""])]);
const pristine = (state: ComposerState) =>
  !state.draft.richValue.some((node) => node.type !== "text" || node.value.trim()) && !state.draft.files.length &&
  !state.queue.items.length && !state.unavailableAttachments.length;

/* The blank page's slot id is new every launch, so its draft is keyed by Project instead; main scopes both by account. */
const BLANK = BLANK_DRAFT_PREFIX;
function durableKey(storeChatId: string, state: ComposerState) {
  return storeChatId === readDraftChatId() && !state.incarnationId
    ? { chatId: `${BLANK}${state.projectId ?? "none"}`, incarnationId: "" }
    : { chatId: storeChatId, incarnationId: state.incarnationId };
}
const splitKey = (key: string) => { const [chatId, incarnationId] = key.split("\u0000") as [string, string]; return { chatId, incarnationId }; };

export function startDurableDrafts(ports: DurableDraftPorts) {
  const debounceMs = ports.debounceMs ?? 400;
  const setTimer = ports.setTimer ?? ((run, ms) => setTimeout(run, ms));
  const clearTimer = ports.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const settled = new Set<string>();
  const revisions = new Map<string, number>();
  const saved = new Map<string, string>();
  const queues = new Map<string, string>();
  const seen = new Map<string, ComposerState>();
  /** The durable key each store Chat last wrote to; a blank draft that moves Project, or becomes a Chat, clears the old one. */
  const written = new Map<string, string>();
  const timers = new Map<string, unknown>();
  /** First loads still in flight: what is typed meanwhile is owed only once they settle, so a quit waits for them. */
  const restoring = new Set<Promise<void>>();
  /** Store Chats whose last save failed: a quit hears that their drafts are not on disk. */
  const failed = new Set<string>();
  let chain: Promise<void> = Promise.resolve();

  const write = async (key: string, draft: DurableComposerDraft | null, fileScopes: Record<string, AgentWorkspaceScope>) => {
    const { chatId, incarnationId } = splitKey(key);
    const text = JSON.stringify({ draft, fileScopes });
    if (text === saved.get(key)) return;
    const once = () => ports.bridge.save({ chatId, incarnationId, baseRevision: revisions.get(key) ?? 0, draft, fileScopes });
    let result: { revision: number };
    try {
      result = await once();
    } catch (cause) {
      if (!String(cause).includes("COMPOSER_DRAFT_CHANGED")) throw cause;
      // Another writer moved the revision (the Chat came back from another window): save once more on the fresh one.
      revisions.set(key, (await ports.bridge.load({ chatId, incarnationId })).revision);
      result = await once();
    }
    revisions.set(key, result.revision);
    saved.set(key, text);
  };

  const save = (storeChatId: string) => {
    chain = chain.then(async () => {
      const state = readComposer(storeChatId);
      if (composerMigrating(storeChatId)) return;
      const key = keyOf(...(Object.values(durableKey(storeChatId, state)) as [string, string]));
      const previous = written.get(storeChatId);
      if (previous && previous !== key) {
        written.delete(storeChatId);
        if (previous.startsWith(BLANK)) {
          await write(previous, null, {});
          // The blank draft moved to another Project's blank page: it carries on there.
          if (key.startsWith(BLANK)) settled.add(key);
        }
      }
      if (!settled.has(key)) return;
      written.set(storeChatId, key);
      const { draft, fileScopes } = toDurable(state, storeChatId, key.startsWith(BLANK));
      await write(key, draft, fileScopes);
      failed.delete(storeChatId);
    }).catch(() => { failed.add(storeChatId); });
    return chain;
  };

  const schedule = (storeChatId: string, ms: number) => {
    const pending = timers.get(storeChatId);
    if (pending !== undefined) clearTimer(pending);
    timers.set(storeChatId, setTimer(() => { timers.delete(storeChatId); void save(storeChatId); }, ms));
  };

  const onChange = () => {
    for (const [storeChatId, state] of readComposerEntries()) {
      if (seen.get(storeChatId) === state) continue;
      seen.set(storeChatId, state);
      const key = keyOf(...(Object.values(durableKey(storeChatId, state)) as [string, string]));
      if (composerMigrating(storeChatId) || (!settled.has(key) && !written.has(storeChatId))) continue;
      const signature = queueSignature(state), urgent = signature !== queues.get(key) || key !== written.get(storeChatId);
      queues.set(key, signature);
      schedule(storeChatId, urgent ? 0 : debounceMs);
    }
  };
  const unsubscribe = subscribeAllComposers(onChange);
  const unsubscribeSlot = subscribeDraftChatId(() => { seen.clear(); onChange(); });

  return {
    /** Restores into an empty composer only, once per durable key; either way it is settled and saves from then on. */
    restore(storeChatId: string, incarnationId: string) {
      const run = restoreOnce(storeChatId, incarnationId);
      restoring.add(run);
      void run.finally(() => restoring.delete(run));
      return run;
    },
    /**
     * Saves every pending change now, before an authorized quit, and says whether every draft this window holds is on disk. A first
     * load still in flight is awaited first, since what was typed during it is only owed once it settles (review 0929 F01). Not saved:
     * a save that failed, or typed text in a Chat whose first load never settled (it failed, so nothing here could write it).
     */
    async flush(): Promise<{ saved: boolean }> {
      // Every await can admit another restore, timer or write; acknowledge only a stable, drained queue.
      for (;;) {
        while (restoring.size) await Promise.allSettled([...restoring]);
        for (const [storeChatId, handle] of timers) {
          clearTimer(handle);
          timers.delete(storeChatId);
          void save(storeChatId);
        }
        const pending = chain;
        await pending;
        if (!restoring.size && !timers.size && chain === pending) break;
      }
      const owed = [...readComposerEntries()].some(([storeChatId, state]) => !composerMigrating(storeChatId) && !pristine(state)
        && !settled.has(keyOf(...(Object.values(durableKey(storeChatId, state)) as [string, string]))));
      return { saved: failed.size === 0 && !owed };
    },
    stop() {
      unsubscribe();
      unsubscribeSlot();
      for (const handle of timers.values()) clearTimer(handle);
      timers.clear();
    },
  };

  async function restoreOnce(storeChatId: string, incarnationId: string) {
    const current = readComposer(storeChatId);
    if (current.incarnationId !== incarnationId) return;
    const target = durableKey(storeChatId, current), key = keyOf(target.chatId, target.incarnationId);
    if (settled.has(key)) return;
    let loaded: Awaited<ReturnType<ComposerDraftsBridgeApi["load"]>>;
    try {
      loaded = await ports.bridge.load(target);
    } catch {
      // Main refused: this window doesn't hold the Chat. It stays unsettled here, so this window never saves it either.
      return;
    }
    try {
      revisions.set(key, loaded.revision);
      const now = readComposer(storeChatId);
      const sameKey = keyOf(...(Object.values(durableKey(storeChatId, now)) as [string, string])) === key;
      const applied = Boolean(loaded.draft && sameKey && pristine(now) && !composerMigrating(storeChatId));
      if (applied) applyRestore(storeChatId, loaded.draft!);
      // The disk matches the composer only when the restore landed or both are empty; anything typed during the load is still owed.
      if (applied || (!loaded.draft && pristine(readComposer(storeChatId)))) saved.set(key, JSON.stringify(toDurable(readComposer(storeChatId), storeChatId)));
      written.set(storeChatId, key);
    } finally {
      settled.add(key);
      queues.set(key, queueSignature(readComposer(storeChatId)));
      // Changes made while the load was in flight were skipped (the key wasn't settled): look at this Chat again now that it is.
      seen.delete(storeChatId);
      onChange();
    }
  }
}

function applyRestore(chatId: string, draft: DurableComposerDraft) {
  const richValue = draft.richValue as RichValue;
  const fileResources = new Map<string, { node: FileNode }>();
  const adopt = (value: RichValue) => { for (const node of value) if (node.type === "file") fileResources.set(node.id, { node }); };
  adopt(richValue);
  const items: QueueItem[] = draft.queue.items.map((item) => {
    const itemRichValue = item.richValue as RichValue;
    adopt(itemRichValue);
    return {
      id: item.id,
      prompt: { richValue: itemRichValue, displayText: item.displayText, attachments: [] },
      ...(item.content ? { content: item.content as QueueItem["content"] } : {}),
      ...(item.custodyIntentId ? { custodyIntentId: item.custodyIntentId } : {}),
      ...(item.outboxRef ? { outboxRef: item.outboxRef } : {}),
      state: item.state,
      ...(item.unavailableAttachment ? { unavailableAttachment: item.unavailableAttachment } : {}),
      createdAt: item.createdAt,
    };
  });
  updateComposer(chatId, (current) => ({
    ...current,
    workspaceIdentityKey: draft.workspaceIdentityKey,
    projectId: draft.projectId,
    draft: { richValue, files: [] },
    unavailableAttachments: [...draft.unavailableAttachments],
    fileResources,
    // A restored queue never sends by itself: it waits, paused and marked, for the person to resume.
    queue: { ...current.queue, items, paused: items.length > 0, ...(items.length ? { restored: items.length } : {}), error: null, revision: current.queue.revision + 1 },
  }));
  for (const ack of draft.pendingAcks) registerPendingComposerAck({ ...ack, chatId });
}

let installed: ReturnType<typeof startDurableDrafts> | null = null;
/** Installs the port once per renderer, when the preload exposed window.composerDrafts. */
export function installDurableDrafts() {
  const bridge = (window as { composerDrafts?: ComposerDraftsBridgeApi }).composerDrafts;
  if (!installed && bridge) installed = startDurableDrafts({ bridge });
}
export const restoreDurableDraft = (chatId: string, incarnationId: string) => installed?.restore(chatId, incarnationId) ?? Promise.resolve();
/** Nothing installed means nothing held here to save. */
export const flushDurableDrafts = (): Promise<{ saved: boolean }> => installed?.flush() ?? Promise.resolve({ saved: true });
