/**
 * [INPUT]: Shared lazy Sketch editor, page-memory draft custody and account lifetime.
 * [OUTPUT]: Editable unsent sources and white PNG attachments with atomic owner checks.
 * [POS]: Web and remote-mirror Sketch adapter; only PNG bytes cross the remote protocol.
 */
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { SketchTranslationProvider, type SketchSession } from "../../../../sketch/platform";
import { createDocument, validateDocument, type SketchDocument } from "../../../../sketch/model/document";
import { useComposerTranslation } from "../../../composer/controls/copy/translation";
import type { RemoteDraftStore } from "../../../../platform/remote/input/draft";
const load = () => import("../../../../sketch/dialog"), Editor = lazy(load);
export function useRemoteSketch(store: RemoteDraftStore, locale: string, lifetime?: AbortSignal) {
  const t = useComposerTranslation(locale);
  const [session, setSession] = useState<SketchSession | null>(null), active = useRef<RemoteDraftStore | null>(null);
  const [owner, setOwner] = useState({ store, lifetime });
  if (owner.store !== store || owner.lifetime !== lifetime) { setOwner({ store, lifetime }); setSession(null); }
  useEffect(() => { active.current = store; const abort = () => { active.current = null; setSession(null); };
    lifetime?.addEventListener("abort", abort, { once: true }); return () => { active.current = null; lifetime?.removeEventListener("abort", abort); };
  }, [store, lifetime]);
  const open = (anchor: HTMLElement | null, attachmentId?: string) => {
    const file = attachmentId ? store.snapshot().files.find(file => file.id === attachmentId) : undefined;
    if (attachmentId && !file?.sketch) return;
    const document = file?.sketch as SketchDocument | undefined ?? createDocument(); validateDocument(document);
    const assertSave = () => {
      if (active.current !== store || lifetime?.aborted) throw new Error("SKETCH_OWNER_EXPIRED");
      if (attachmentId && store.snapshot().files.find(value => value.id === attachmentId)?.file !== file?.file) throw new Error("SKETCH_VERSION_CHANGED");
      if (!attachmentId && store.snapshot().files.length >= 8) throw new Error("SKETCH_ATTACHMENT_LIMIT");
    };
    setSession({ id: crypto.randomUUID(), owner: { chatId: "remote-draft", epoch: 0, incarnationId: null, valid: () => active.current === store && !lifetime?.aborted }, document, attachmentId, assertSave,
      save: (source, png) => { assertSave(); store.add([png], source, attachmentId); },
      close: () => { setSession(null); queueMicrotask(() => anchor?.isConnected && anchor.focus()); } });
  };
  return { open, preload: () => { void load().catch(() => {}); }, active: Boolean(session),
    dialog: session ? <SketchTranslationProvider value={t}><Suspense fallback={<p role="status">{t("sketch.processing")}</p>}><Editor key={session.id} session={session} /></Suspense></SketchTranslationProvider> : null };
}
