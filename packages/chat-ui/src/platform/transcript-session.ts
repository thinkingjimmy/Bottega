/**
 * [INPUT]: Depends on injected transcript pages, verified Chat heads, bounded imported-body preparation and an optional host cache of prepared bodies.
 * [OUTPUT]: Publishes complete initial windows once, retains readable content during revision refresh and reuses verified imported bodies across virtual row mounts and, where a host offers one, across sessions.
 * [POS]: Session-scoped presentation state with ordered, bounded imported-prefix/native-suffix paging and cancellable reads.
 */
import type { ChatBody } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { ImportedEntry } from "@ai-chat/cloud-protocol/chats/imported/model";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { TranscriptSource } from "./contracts";
import type { TranscriptPage } from "./model";
import { prepareImportedBody, type PreparedImportedField } from "./transcript/fields";
import { readInParallel } from "./transcript/parallel";
export type TranscriptItem = { kind: "native"; body: ChatBody } | { kind: "imported"; entry: ImportedEntry; backend?: TranscriptPage["importedBackend"]; content?: PreparedImportedField };
type Snapshot = { items: TranscriptItem[]; busy: boolean; error: boolean; state: "pending" | "ready" | "partial" | "unavailable"; canEarlier: boolean; latest: boolean };
export class TranscriptSession {
  private value: Snapshot = { items: [], busy: true, error: false, state: "pending", canEarlier: false, latest: true };
  private readonly listeners = new Set<() => void>();
  private request: AbortController | null = null;
  private stop: (() => void) | null = null;
  private nativePage: TranscriptPage | null = null;
  private importedPage: TranscriptPage | null = null;
  private head: CloudChatHead | undefined;
  private closed = true;
  private lifetime = 0;
  constructor(private readonly chatId: string, private readonly source: TranscriptSource, private readonly targetMessageId?: string | null, private readonly incarnationId?: string) {}
  snapshot = () => this.value;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(value: Partial<Snapshot>) { if (!this.closed) { this.value = { ...this.value, ...value }; for (const listener of this.listeners) listener(); } }
  setHead(head: CloudChatHead) {
    if (head.chat.id !== this.chatId || this.incarnationId && head.chat.incarnationId !== this.incarnationId) throw new Error("CHAT_IDENTITY_CHANGED");
    const previous = this.head; this.head = head;
    if (previous && !this.closed && (previous.bodyRevision !== head.bodyRevision || previous.chat.incarnationId !== head.chat.incarnationId)) {
      void (this.targetMessageId && this.source.locate ? this.seek(this.targetMessageId) : this.latest());
    }
  }
  open() {
    if (!this.closed) return;
    this.closed = false; const lifetime = ++this.lifetime;
    this.stop = this.source.subscribe(this.chatId, () => {
      if (!this.value.busy && (this.value.error || this.value.state === "pending")) void this.latest();
    }, () => this.update({ error: true }));
    // StrictMode replays effects before this microtask; only the surviving mount should start a read.
    queueMicrotask(() => {
      if (this.closed || lifetime !== this.lifetime) return;
      void (this.targetMessageId && this.source.locate ? this.seek(this.targetMessageId) : this.latest());
    });
  }
  private async items(page: TranscriptPage, signal: AbortSignal): Promise<TranscriptItem[]> {
    if (page.segment === "native") return [...page.messages].sort((a, b) => a.message.seq - b.message.seq).map(body => ({ kind: "native", body }));
    const known = new Map(this.value.items.flatMap(item => item.kind === "imported" && item.content && !item.content.error ? [[item.entry.entryVersionId, item.content] as const] : []));
    const prepared = this.source.prepared;
    return readInParallel([...page.imported].sort((a, b) => a.deliverySeq - b.deliverySeq), signal, async entry => {
      // Imported entry versions are content-addressed, so a host cache outlives this session's own reuse map.
      const key = `${this.chatId}:${entry.entryVersionId}`;
      const content = known.get(entry.entryVersionId) ?? await prepared?.get(key) ?? await prepareImportedBody(this.chatId, entry, this.source, signal);
      if (content && !content.error) prepared?.set(key, content);
      return { kind: "imported" as const, entry, backend: page.importedBackend, content };
    }, 12);
  }
  private current(request: AbortController) { return !this.closed && request === this.request && !request.signal.aborted; }
  private begin(latest: boolean) {
    this.request?.abort(); const request = new AbortController(); this.request = request;
    this.update({ busy: true, error: false, latest }); return request;
  }
  async seek(messageId: string, location?: { segment: "native" | "imported"; seq: number }) {
    const request = this.begin(false);
    try {
      const target = location ?? await this.source.locate?.(this.chatId, messageId, request.signal);
      if (!target) throw new Error("CHAT_MESSAGE_UNAVAILABLE");
      const page = await this.source.page({ chatId: this.chatId, segment: target.segment, revision: target.segment === "native" ? this.head?.bodyRevision ?? null : null,
        generationId: null, beforeSeq: target.seq + 1, limit: 50 }, request.signal, this.head);
      const items = await this.items(page, request.signal);
      if (!this.current(request)) return;
      this.nativePage = target.segment === "native" ? page : { ...page, segment: "native", complete: true, messages: [], imported: [] };
      this.importedPage = target.segment === "imported" ? page : null;
      this.update({ items, busy: false, state: page.state, canEarlier: page.state === "ready" });
    } catch { if (this.current(request)) this.update({ busy: false, error: true }); }
  }
  async latest() {
    const request = this.begin(true);
    let nativeItems: TranscriptItem[] | undefined;
    let authoritative = false;
    if (this.head && this.source.preview && !this.value.items.length) void this.source.preview(this.chatId, this.head, request.signal).then(async preview => {
      if (!preview) return;
      const [native, imported] = await Promise.all([this.items(preview.native, request.signal), preview.imported ? this.items(preview.imported, request.signal) : []]);
      if (this.current(request) && !authoritative) this.update({ items: [...imported, ...native], state: "ready" });
    }).catch(() => {});
    try {
      const importedRead = this.head && this.head.kind !== "native" && this.head.headSeq === 0 ? this.source.page({ chatId: this.chatId, segment: "imported", revision: null,
        generationId: null, beforeSeq: null, limit: 50 }, request.signal, this.head) : null;
      void importedRead?.catch(() => {});
      const native = await this.source.page({ chatId: this.chatId, segment: "native", revision: null, generationId: null, beforeSeq: null, limit: 50 }, request.signal, this.head);
      if (!this.current(request)) return;
      nativeItems = await this.items(native, request.signal);
      this.nativePage = native; this.importedPage = null;
      let imported: TranscriptPage | null = null;
      if (native.complete && native.messages.length < 50) imported = await (importedRead ?? this.source.page({ chatId: this.chatId, segment: "imported", revision: null,
        generationId: null, beforeSeq: null, limit: 50 - native.messages.length }, request.signal, this.head));
      const importedItems = imported ? await this.items(imported, request.signal) : [];
      if (!this.current(request)) return;
      this.importedPage = imported; authoritative = true;
      this.update({ items: [...importedItems, ...nativeItems], busy: false,
        canEarlier: native.state === "ready" && (!native.complete || !imported?.complete), state: native.state !== "ready" ? native.state : imported?.state ?? "ready" });
    } catch {
      authoritative = true;
      // A failed prefix cannot hide a verified suffix, but intermediate successful stages do not replace the skeleton.
      if (this.current(request)) this.update({ ...(nativeItems?.length && !this.value.items.length ? { items: nativeItems } : {}), busy: false, error: true });
    }
  }
  async earlier() {
    if (this.value.busy || !this.value.canEarlier || !this.nativePage) return;
    const request = this.begin(this.value.latest);
    const segment = this.nativePage.complete ? "imported" : "native", previous = segment === "native" ? this.nativePage : this.importedPage;
    try {
      const page = await this.source.page({ chatId: this.chatId, segment, revision: previous?.revision ?? null, generationId: previous?.generationId ?? null,
        beforeSeq: previous?.cursor ?? null, limit: 50 }, request.signal, this.head);
      const items = await this.items(page, request.signal);
      if (!this.current(request)) return;
      if (segment === "native") this.nativePage = page; else this.importedPage = page;
      const all = [...items, ...this.value.items], unique = new Map(all.map(item => [item.kind === "native" ? `native:${item.body.message.id}` : `imported:${item.entry.entryVersionId}`, item]));
      this.update({ items: [...unique.values()].slice(0, 200), latest: this.value.latest && unique.size <= 200, busy: false, canEarlier: segment === "native" || !page.complete, state: page.state });
    } catch (error) {
      if (this.current(request)) {
        if (/MIRROR_HEAD_CHANGED|CHAT_BODY_CHANGED|IMPORT_GENERATION_CHANGED/.test(String(error))) { await this.latest(); return; }
        this.update({ busy: false, error: true });
      }
    }
  }
  close() { this.closed = true; ++this.lifetime; this.request?.abort(); this.stop?.(); this.stop = null; }
}
