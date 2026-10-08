/**
 * [INPUT]: Depends on injected transcript pages, verified Chat heads, bounded imported-body preparation an optional host cache of prepared bodies and bounded local receive diagnostics.
 * [OUTPUT]: Records opaque installed body watermarks independently of live settlement. Publishes complete initial windows once (a first read that failed is read again on the next head update, F07), retains readable content during revision refresh, reads only appended messages for a new head within one rewrite epoch (R-04) against an installed watermark kept apart from the observed head, catching up after any read (initial, delta or earlier()) a head that arrived meanwhile (C2-02, C3-01), and keeps earlier() contiguous after appends trim the window (its cursor moves to the oldest row still shown), and reuses verified imported bodies across virtual row mounts and, where a host offers one, across sessions.
 * A failed initial imported window can retry latest even when native rows already loaded.
 * [POS]: Session-scoped presentation state, generic over its rows and head (cloud rows by default; a host such as desktop native supplies its own), with ordered, bounded imported-prefix/native-suffix paging and cancellable reads.
 */
import type { ChatBody } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { ImportedEntry } from "@ai-chat/cloud-protocol/chats/imported/model";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { TranscriptSource } from "./contracts";
import type { TranscriptPage, TranscriptRequest } from "./model";
import { prepareImportedBody, type PreparedImportedField } from "./transcript/fields";
import { beginReceive } from "./transcript/receive-diagnostics";
import { readInParallel } from "./transcript/parallel";
export type TranscriptItem<Native = ChatBody, Imported = ImportedEntry> =
  | { kind: "native"; body: Native }
  | { kind: "imported"; entry: Imported; backend?: TranscriptPage["importedBackend"]; content?: PreparedImportedField };
/** The head fields the session reads; a cloud head is one, and a host with its own rows (desktop native) builds one. */
export type SessionHead = Readonly<{ chat: Readonly<{ id: string; incarnationId: string }>; kind: CloudChatHead["kind"]; headSeq: number; bodyRevision: number; rewriteEpoch: number }>;
export type SessionPage<Native, Imported> = Omit<TranscriptPage, "messages" | "imported"> & { messages: readonly Native[]; imported: readonly Imported[] };
export type SessionSource<Native, Imported, Head extends SessionHead> = Pick<TranscriptSource, "subscribe" | "locate"> & {
  page(input: TranscriptRequest, signal: AbortSignal, head?: Head): Promise<SessionPage<Native, Imported>>;
  preview?(chatId: string, head: Head, signal: AbortSignal): Promise<{ native: SessionPage<Native, Imported>; imported?: SessionPage<Native, Imported> } | undefined>;
};
/** How a host's rows are ordered, keyed and (for imported rows) prepared; the cloud rows below are the session's default. */
export type TranscriptRows<Native, Imported> = Readonly<{
  nativeSeq(row: Native): number;
  nativeKey(row: Native): string;
  importedKey(row: Imported): string;
  imported(page: SessionPage<Native, Imported>, shown: readonly TranscriptItem<Native, Imported>[], signal: AbortSignal): Promise<TranscriptItem<Native, Imported>[]>;
}>;
export function cloudTranscriptRows(chatId: string, source: TranscriptSource): TranscriptRows<ChatBody, ImportedEntry> {
  return {
    nativeSeq: (body) => body.message.seq,
    nativeKey: (body) => body.message.id,
    importedKey: (entry) => entry.entryVersionId,
    imported: (page, shown, signal) => {
      const known = new Map(shown.flatMap(item => item.kind === "imported" && item.content && !item.content.error ? [[item.entry.entryVersionId, item.content] as const] : []));
      const prepared = source.prepared;
      return readInParallel([...page.imported].sort((a, b) => a.deliverySeq - b.deliverySeq), signal, async entry => {
        // Imported entry versions are content-addressed, so a host cache outlives this session's own reuse map.
        const key = `${chatId}:${entry.entryVersionId}`;
        const content = known.get(entry.entryVersionId) ?? await prepared?.get(key) ?? await prepareImportedBody(chatId, entry, source, signal);
        if (content && !content.error) prepared?.set(key, content);
        return { kind: "imported" as const, entry, backend: page.importedBackend, content };
      }, 12);
    },
  };
}
type Snapshot<Native, Imported> = { items: TranscriptItem<Native, Imported>[]; busy: boolean; error: boolean; state: "pending" | "ready" | "partial" | "unavailable"; canEarlier: boolean; latest: boolean };
export class TranscriptSession<Native = ChatBody, Imported = ImportedEntry, Head extends SessionHead = CloudChatHead> {
  private value: Snapshot<Native, Imported> = { items: [], busy: true, error: false, state: "pending", canEarlier: false, latest: true };
  private readonly listeners = new Set<() => void>();
  private request: AbortController | null = null;
  private stop: (() => void) | null = null;
  private nativePage: SessionPage<Native, Imported> | null = null;
  private importedPage: SessionPage<Native, Imported> | null = null;
  private head: Head | undefined;
  /** What the tail on screen holds (R-04): kept apart from the observed head, which can move while a read is in flight. */
  private installed: { incarnationId: string; epoch: number; seq: number } | null = null;
  private closed = true;
  private lifetime = 0;
  private progress: ReturnType<typeof beginReceive> | null = null;
  private readonly rows: TranscriptRows<Native, Imported>;
  constructor(private readonly chatId: string, private readonly source: SessionSource<Native, Imported, Head>, private readonly targetMessageId?: string | null,
    private readonly incarnationId?: string, rows?: TranscriptRows<Native, Imported>) {
    this.rows = rows ?? cloudTranscriptRows(chatId, source as unknown as TranscriptSource) as unknown as TranscriptRows<Native, Imported>;
  }
  snapshot = () => this.value;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(value: Partial<Snapshot<Native, Imported>>) { if (!this.closed) { if (value.error) this.progress?.update({ phase: "failed" }); this.value = { ...this.value, ...value }; for (const listener of this.listeners) listener(); } }
  setHead(head: Head) {
    if (head.chat.id !== this.chatId || this.incarnationId && head.chat.incarnationId !== this.incarnationId) throw new Error("CHAT_IDENTITY_CHANGED");
    const previous = this.head; this.head = head;
    if (!this.closed && previous && (previous.chat.incarnationId !== head.chat.incarnationId || previous.rewriteEpoch !== head.rewriteEpoch)) {
      this.progress?.close(); this.progress = beginReceive("body");
    }
    /* A first read that failed installed no window, and a host whose source has no change feed (desktop's native port) would never ask
       again: the next head update is the moment to read once more (review 0929 F07). */
    if (!this.closed && !this.value.busy && this.value.error && !this.installed) {
      void (this.targetMessageId && this.source.locate ? this.seek(this.targetMessageId) : this.latest());
      return;
    }
    /* R-04: within one incarnation and rewrite epoch the rows shown never change; a tail on screen gains only what followed,
       and a reader scrolled back keeps its window. */
    if (previous && !this.closed && previous.chat.incarnationId === head.chat.incarnationId && previous.rewriteEpoch === head.rewriteEpoch) {
      // A head that arrives mid-read is picked up when that read finishes (catchUp).
      if (!this.value.busy) this.catchUp();
      return;
    }
    if (previous && !this.closed && (previous.bodyRevision !== head.bodyRevision || previous.chat.incarnationId !== head.chat.incarnationId)) {
      void (this.targetMessageId && this.source.locate ? this.seek(this.targetMessageId) : this.latest());
    }
  }
  open() {
    if (!this.closed) return;
    this.closed = false; this.progress = beginReceive("body"); const lifetime = ++this.lifetime;
    this.stop = this.source.subscribe(this.chatId, () => {
      if (!this.value.busy && (this.value.error || this.value.state === "pending")) void this.latest();
    }, () => this.update({ error: true }));
    // StrictMode replays effects before this microtask; only the surviving mount should start a read.
    queueMicrotask(() => {
      if (this.closed || lifetime !== this.lifetime) return;
      void (this.targetMessageId && this.source.locate ? this.seek(this.targetMessageId) : this.latest());
    });
  }
  private async items(page: SessionPage<Native, Imported>, signal: AbortSignal): Promise<TranscriptItem<Native, Imported>[]> {
    if (page.segment === "native") return [...page.messages].sort((a, b) => this.rows.nativeSeq(a) - this.rows.nativeSeq(b)).map(body => ({ kind: "native", body }));
    return this.rows.imported(page, this.value.items, signal);
  }
  /** Installs a native tail read at `headSeq` (the page's read-time head, else its newest row) under the head it was read for. */
  private install(page: SessionPage<Native, Imported>, after: number, readFor: Head | undefined) {
    const newest = page.messages.reduce((top, body) => Math.max(top, this.rows.nativeSeq(body)), after);
    this.installed = { incarnationId: page.incarnationId, epoch: readFor?.rewriteEpoch ?? page.revision, seq: Math.max(page.headSeq ?? newest, newest) };
    // The delivery head can be ahead of this window; diagnostics name only rows actually loaded.
    this.progress?.update({ phase: "body-installed", ...(page.messages.length ? {
      installedBodySeq: page.messages.reduce((top, body) => Math.max(top, this.rows.nativeSeq(body)), 0) } : {}) });
  }
  /** After any read: a tail on screen that is behind the observed head in the same epoch reads the difference. */
  private catchUp() {
    const head = this.head, installed = this.installed;
    if (!head || !installed || this.closed || this.value.busy || !this.value.latest || this.value.state !== "ready" || this.targetMessageId) return;
    if (head.chat.incarnationId === installed.incarnationId && head.rewriteEpoch === installed.epoch && head.headSeq > installed.seq) void this.appended(installed.seq);
  }
  /** Rows trimmed off the front of the window must be what earlier() reads next: the cursor moves to the oldest row still shown. */
  private reanchor(kept: TranscriptItem<Native, Imported>[]) {
    const oldest = kept.find((item) => item.kind === "native");
    if (!oldest || oldest.kind !== "native" || !this.nativePage) return;
    this.nativePage = { ...this.nativePage, cursor: this.rows.nativeSeq(oldest.body), complete: false };
    this.importedPage = null;
  }
    private current(request: AbortController) { return !this.closed && request === this.request && !request.signal.aborted; }
  private begin(latest: boolean) {
    this.request?.abort(); const request = new AbortController(); this.request = request;
    this.progress?.update({ phase: "reading-body" });
    this.update({ busy: true, error: false, latest }); return request;
  }
  async seek(messageId: string, location?: { segment: "native" | "imported"; seq: number }) {
    const request = this.begin(false);
    try {
      const target = location ?? await this.source.locate?.(this.chatId, messageId, request.signal);
      if (!target) throw new Error("CHAT_MESSAGE_UNAVAILABLE");
      const page = await this.source.page({ chatId: this.chatId, segment: target.segment, revision: null,
        generationId: null, beforeSeq: target.seq + 1, limit: 50 }, request.signal, this.head);
      const items = await this.items(page, request.signal);
      if (!this.current(request)) return;
      this.nativePage = target.segment === "native" ? page : { ...page, segment: "native", complete: true, messages: [], imported: [] };
      this.importedPage = target.segment === "imported" ? page : null;
      this.update({ items, busy: false, state: page.state, canEarlier: page.state === "ready" });
    } catch { if (this.current(request)) this.update({ busy: false, error: true }); }
  }
  /** Appends what followed `after`; more than one page of new messages, or anything unexpected, falls back to the tail. */
  private async appended(after: number) {
    const request = this.begin(true), readFor = this.head;
    try {
      const page = await this.source.page({ chatId: this.chatId, segment: "native", revision: null, generationId: null, beforeSeq: null, afterSeq: after, limit: 50 },
        request.signal, this.head);
      if (!this.current(request)) return;
      if (!page.complete || page.state !== "ready") { await this.latest(); return; }
      // A host that ignores `afterSeq` returns its tail; only what follows `after` is new.
      const fresh = (await this.items({ ...page, messages: page.messages.filter(body => this.rows.nativeSeq(body) > after) }, request.signal));
      if (!this.current(request)) return;
      const items = [...this.value.items, ...fresh], kept = items.slice(-200);
      this.install(page, after, readFor);
      if (kept.length < items.length) this.reanchor(kept);
      this.update({ items: kept, busy: false, canEarlier: this.value.canEarlier || items.length > 200 });
      // A read that moved nothing waits for the next head instead of asking again at once.
      if (this.installed!.seq > after) this.catchUp();
    } catch { if (this.current(request)) await this.latest(); }
  }
  async latest() {
    const request = this.begin(true), readFor = this.head;
    let nativeItems: TranscriptItem<Native, Imported>[] | undefined;
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
      let imported: SessionPage<Native, Imported> | null = null;
      if (native.complete && native.messages.length < 50) imported = await (importedRead ?? this.source.page({ chatId: this.chatId, segment: "imported", revision: null,
        generationId: null, beforeSeq: null, limit: 50 - native.messages.length }, request.signal, this.head));
      const importedItems: TranscriptItem<Native, Imported>[] = imported ? await this.items(imported, request.signal) : [];
      if (!this.current(request)) return;
      this.importedPage = imported; authoritative = true;
      this.installed = null; if (native.state === "ready") this.install(native, 0, readFor);
      this.update({ items: [...importedItems, ...nativeItems], busy: false,
        canEarlier: native.state === "ready" && (!native.complete || !imported?.complete), state: native.state !== "ready" ? native.state : imported?.state ?? "ready" });
      this.catchUp();
    } catch {
      authoritative = true;
      // A failed prefix cannot hide a verified suffix, but intermediate successful stages do not replace the skeleton.
      if (this.current(request)) this.update({ ...(nativeItems?.length && !this.value.items.length ? { items: nativeItems } : {}), busy: false, error: true });
    }
  }
  async earlier() {
    // A partial initial read has no installed window; retry both segments instead of paging an incomplete prefix.
    if (this.value.error && !this.installed && !this.value.busy) return this.latest();
    if (this.value.busy || !this.value.canEarlier || !this.nativePage) return;
    const request = this.begin(this.value.latest);
    const segment = this.nativePage.complete ? "imported" : "native", previous = segment === "native" ? this.nativePage : this.importedPage;
    try {
      const page = await this.source.page({ chatId: this.chatId, segment, revision: previous?.revision ?? null, generationId: previous?.generationId ?? null,
        beforeSeq: previous?.cursor ?? null, limit: 50 }, request.signal, this.head);
      const items = await this.items(page, request.signal);
      if (!this.current(request)) return;
      if (segment === "native") this.nativePage = page; else this.importedPage = page;
      const all = [...items, ...this.value.items], unique = new Map(all.map(item => [item.kind === "native" ? `native:${this.rows.nativeKey(item.body)}` : `imported:${this.rows.importedKey(item.entry)}`, item]));
      this.update({ items: [...unique.values()].slice(0, 200), latest: this.value.latest && unique.size <= 200, busy: false, canEarlier: segment === "native" || !page.complete, state: page.state });
      // C3-01: a head that arrived during this read was deferred; the tail on screen catches up now. The older page never
      // moves the watermark, and a window that left the tail (over 200 rows) stays where the reader put it.
      this.catchUp();
    } catch (error) {
      if (this.current(request)) {
        if (/MIRROR_HEAD_CHANGED|CHAT_BODY_CHANGED|IMPORT_GENERATION_CHANGED/.test(String(error))) { await this.latest(); return; }
        this.update({ busy: false, error: true });
      }
    }
  }
  close() { this.progress?.close(); this.closed = true; ++this.lifetime; this.request?.abort(); this.stop?.(); this.stop = null; }
}
