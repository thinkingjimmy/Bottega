/**
 * [INPUT]: Depends on the composer owner and the shared bounded revision-fenced local draft contract.
 * [OUTPUT]: Retains editable text across save errors and route changes, validates writes and resumes acknowledged drafts after restart.
 * [POS]: Renderer draft adapter; text never enters a cloud mutation and Enter never claims execution.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { CloudChatBridge } from "../../../../shared/cloud/chat";
import { executionDraftWriteSchema, type ExecutionDraft } from "../../../../shared/cloud/execution";
import { primeComposer, readComposer, subscribeComposer, updateComposer } from "../../chat-composer-store";
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
      while (this.desired !== null && this.desired !== this.confirmed!.text) {
        const text = this.desired, expectedRevision = this.confirmed!.revision;
        try { this.confirmed = await this.bridge.saveDraft(executionDraftWriteSchema.parse({ chatId: this.chatId, incarnationId: this.incarnationId, text, expectedRevision })); }
        catch (error) { this.publish({ ready: true, error: true }); throw error; }
      }
      this.publish({ ready: true, error: false });
    };
    this.flight = run().finally(() => { this.flight = null; }); return this.flight;
  }
  async retry() { if (!this.confirmed) this.open(); await this.flush(); }
  close() { this.generation++; this.unsubscribe?.(); this.unsubscribe = null; void this.flush().catch(() => {}); }
}
export function useContinuationDraft(chatId?: string, incarnationId?: string, accountId?: string) {
  const session = useMemo(() => chatId && incarnationId && accountId && window.cloudChat ? new ContinuationDraftSession(window.cloudChat, chatId, incarnationId) : null, [chatId, incarnationId, accountId]);
  useEffect(() => { session?.open(); return () => session?.close(); }, [session]);
  const state = useSyncExternalStore(session?.subscribe ?? (() => () => {}), session?.snapshot ?? (() => unavailable));
  return { ...state, flush: () => session?.flush() ?? Promise.resolve(), retry: () => session?.retry() ?? Promise.resolve() };
}
