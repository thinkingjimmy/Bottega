/**
 * [INPUT]: Public plugin SDK, the embedded Sketch panel, matching loading content and explicit source/checkpoint codec.
 * [OUTPUT]: SketchPlugin fills the host modal with its editor or closable preparation state, with author-editable configuration and awaited terminal actions.
 * [POS]: Official iframe contents bundled into the fixed compiler; no second modal, native storage, IPC or host DOM access.
 */
import { useEffect, useRef, useState } from 'react';
import { usePlugin } from '@bottega/plugin-react';
import { SketchPanel } from '../../sketch/panel';
import { SketchLoading } from '../../sketch/host/loading';
import { SketchTranslationProvider, type SketchSession } from '../../sketch/platform';
import { createDocument, validateDocument, type ShapeType, type SketchDocument } from '../../sketch/model/document';
import type { SketchCheckpoint } from '../../sketch/editor/state';
import { useComposerTranslation } from '../../ui/composer/controls/copy/translation';
import { decodePluginValue, encodePluginValue } from '../codec';
import { createPluginCoverageWorker } from '../compute';
export type SketchPluginProps = { palette?: readonly string[]; shapes?: readonly ShapeType[] };
function SketchPreparation({ failed, t, onClose }: { failed: boolean; t: ReturnType<typeof useComposerTranslation>; onClose(): void }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => { panel.current?.querySelector('button')?.focus({ preventScroll: true }); }, [failed]);
  return <SketchTranslationProvider value={t}><div ref={panel} className="sketch-panel" style={{ height: '100dvh' }}
    onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); onClose(); } }}>
    {failed ? <div className="sketch-preparation" role="alert"><p>{t('sketch.versionRequired')}</p>
      <button onClick={onClose}>{t('common.close')}</button></div> : <SketchLoading onClose={onClose} />}
  </div></SketchTranslationProvider>;
}
export function SketchPlugin({ palette, shapes }: SketchPluginProps) {
  const plugin = usePlugin(), session = plugin.session, t = useComposerTranslation(session?.locale ?? 'en');
  const [state, setState] = useState<{ document: SketchDocument; recovery?: SketchCheckpoint } | null>(null);
  const [failure, setFailure] = useState(false);
  useEffect(() => {
    if (!session) return;
    if(session.recoveryIncompatible)return;
    let active = true;
    void (async () => {
      const document = session.sourceId ? decodePluginValue(await plugin.readSource(session.sourceId)) as SketchDocument : createDocument();
      validateDocument(document);
      let recovery = session.recoverySourceId ? decodePluginValue(await plugin.readSource(session.recoverySourceId)) as SketchCheckpoint : undefined;
      if (recovery) validateDocument(recovery.document);
      if (session.attachmentId && recovery && recovery.document.id !== document.id) recovery = undefined;
      if (active) setState({ document, recovery });
    })().catch(() => { if (active) setFailure(true); });
    return () => { active = false; };
  }, [session?.sessionId]);
  if (failure || session?.recoveryIncompatible || !session || !state) return <SketchPreparation failed={failure || Boolean(session?.recoveryIncompatible)} t={t} onClose={() => { void plugin.close().catch(() => {}); }} />;
  const editorSession: SketchSession = {
    id: session.sessionId, owner: { chatId: session.sessionId, epoch: 0, incarnationId: null }, document: state.document,
    recovery: state.recovery, attachmentId: session.attachmentId, configuration: { palette, shapes },
    createWorker: () => createPluginCoverageWorker({ compute: (bytes, signal) => plugin.computeCoverage(bytes, signal), close: () => { void plugin.cancelCoverage().catch(() => {}); } }),
    assertSave() {},
    save: async (document, image) => { await plugin.submitAttachment({ image, source: encodePluginValue(document), format: {id:session.sourceFormat.id,version:session.sourceFormat.version}, replaceAttachmentId: session.attachmentId }); },
    checkpoint: async checkpoint => { await plugin.checkpoint(encodePluginValue(checkpoint), {id:session.sourceFormat.id,version:session.sourceFormat.version}); },
    dirty: value => { void plugin.setDirty(value).catch(() => {}); },
    close: saved => plugin.close(saved ? { saved: true } : { discarded: true }),
  };
  return <SketchTranslationProvider value={t}><div style={{ height: '100dvh' }}><SketchPanel session={editorSession} /></div></SketchTranslationProvider>;
}
