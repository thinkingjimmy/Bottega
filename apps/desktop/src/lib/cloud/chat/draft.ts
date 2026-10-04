/**
 * [INPUT]: Depends on the composer owner and the shared bounded revision-fenced local draft contract.
 * [OUTPUT]: Retains editable text across save errors and route changes, validates writes, re-reads on a revision conflict, shares one session per Chat incarnation and account, and resumes acknowledged drafts after restart.
 * [POS]: Renderer draft adapter; text never enters a cloud mutation and Enter never claims execution.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { CloudChatBridge } from "../../../../shared/cloud/chat";
import { executionDraftWriteSchema, type ExecutionDraft } from "../../../../shared/cloud/execution";
import { primeComposer, readComposer, subscribeComposer, updateComposer } from "../../chat/state/composer/chat-composer-store";
type State = { ready: boolean; error: boolean };
const unavailable: State = { ready: false, error: false };
export class ContinuationDraftSession {
  private confirmed: ExecutionDraft | null = null;
  private desired: string | null = null;
  private state: State = unavailable;
  private flight: Promise<void> | null = null;
  private initialized: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  private unsubscribe: (() => void) | null = null;
  private generation = 0;
  constructor(private bridge: Pick<CloudChatBridge, "draft" | "saveDraft">, private chatId: string, private incarnationId: string) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(value: State) { this.state = value; for (const listener of this.listeners) listener(); }
  private text() { return readComposer(this.chatId).draft.richValue.filter(node => node.type === "text").map(node => node.value).join(""); }
  open() {
    const generation = ++this.generation; primeComposer(this.chatId, this.incarnationId);
    this.unsubscribe?.();
    let edited = false;
    this.unsubscribe = subscribeComposer(this.chatId, () => { edited = true; this.desired = this.text(); if (this.confirmed) void this.flush().catch(() => {}); });
    this.initialized = this.bridge.draft({ chatId: this.chatId, incarnationId: this.incarnationId }).then(draft => {
      if (generation !== this.generation) return;
      this.confirmed = draft;
      const composer = readComposer(this.chatId);
      if (!edited && !composer.draft.richValue.length && !composer.draft.files.length && draft.text) {
        updateComposer(this.chatId, current => ({ ...current, draft: { ...current.draft, richValue: [{ id: crypto.randomUUID(), type: "text", value: draft.text }] } }));
      }
      this.desired = this.text(); this.publish({ ready: true, error: false });
    }).catch(() => { if (generation === this.generation) this.publish({ ready: false, error: true }); });
    void this.initialized.then(() => this.flush()).catch(() => {});
  }
  async flush(): Promise<void> {
    await this.initialized;
    if (!this.confirmed) throw new Error("EXECUTION_DRAFT_UNAVAILABLE");
    if (this.flight) return this.flight;
    const run = async () => {
      let conflicts = 0;
      while (this.desired !== null && this.desired !== this.confirmed!.text) {
        const text = this.desired, expectedRevision = this.confirmed!.revision;
        try { this.confirmed = await this.bridge.saveDraft(executionDraftWriteSchema.parse({ chatId: this.chatId, incarnationId: this.incarnationId, text, expectedRevision })); }
        catch (error) {
          /* Another writer moved the revision: read it and write this text over it, instead of failing Continue for good (F-35). */
          if (String(error).includes("EXECUTION_DRAFT_CHANGED") && ++conflicts <= 3) {
            try { this.confirmed = await this.bridge.draft({ chatId: this.chatId, incarnationId: this.incarnationId }); continue; } catch { /* Reported below. */ }
          }
          this.publish({ ready: true, error: true }); throw error;
        }
      }
      this.publish({ ready: true, error: false });
    };
    this.flight = run().finally(() => { this.flight = null; }); return this.flight;
  }
  async retry() { if (!this.confirmed) this.open(); await this.flush(); }
  close() { this.generation++; this.unsubscribe?.(); this.unsubscribe = null; void this.flush().catch(() => {}); }
}
/* The Chat page and its status row both edit the same continuation draft; two sessions raced each other's
   revision and could fail Continue for good (F-35). One session per Chat incarnation and account serves both. */
const shared = new Map<string, { session: ContinuationDraftSession; users: number }>();
function sharedSession(key: string, chatId: string, incarnationId: string) {
  let entry = shared.get(key);
  if (!entry) { entry = { session: new ContinuationDraftSession(window.cloudChat!, chatId, incarnationId), users: 0 }; shared.set(key, entry); }
  return entry;
}
export function useContinuationDraft(chatId?: string, incarnationId?: string, accountId?: string) {
  const key = chatId && incarnationId && accountId && window.cloudChat ? JSON.stringify([chatId, incarnationId, accountId]) : null;
  const session = useMemo(() => key ? sharedSession(key, chatId!, incarnationId!).session : null, [key, chatId, incarnationId]);
  useEffect(() => {
    if (!key || !session) return;
    // The session this render subscribed to is the one kept, even if its entry was released in between.
    let entry = shared.get(key);
    if (entry?.session !== session) { entry = { session, users: 0 }; shared.set(key, entry); }
    if (entry.users++ === 0) entry.session.open();
    return () => { if (--entry.users === 0) { entry.session.close(); if (shared.get(key) === entry) shared.delete(key); } };
  }, [key, session]);
  const state = useSyncExternalStore(session?.subscribe ?? (() => () => {}), session?.snapshot ?? (() => unavailable));
  return { ...state, flush: () => session?.flush() ?? Promise.resolve(), retry: () => session?.retry() ?? Promise.resolve() };
}
