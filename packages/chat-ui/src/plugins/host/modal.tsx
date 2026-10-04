/**
 * [INPUT]: Shared heartbeat timing, a host-injected Surface, current-draft publication and opaque editor sources.
 * [OUTPUT]: PluginComposerModal owns one bounded dialog across loading, ready and failure, plus per-open dispatch, recovery and liveness.
 * [POS]: Shared composer modal shell; the isolated frame supplies its contents without a second dialog.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogTitle } from '@ai-chat/ui/components/ui/dialog';
import { AppDialogContent } from '@ai-chat/ui/components/ui/app-dialog';
import { PLUGIN_SURFACE_LIVENESS } from '@bottega/contracts/plugins/surface/contract';
import type { PluginSource } from '@bottega/contracts/plugins/surface/source';
import { useComposerTranslation } from '../../ui/composer/controls/copy/translation';
import { PluginComposerSession } from './dispatcher';
import { recoveryForScope } from './recovery';
import { usePluginSurfaceEnvironment } from './context';
import type { PluginComposerEntry, PluginEndReason, PluginHostScope, PluginSourceFormat } from './contracts';
export type PluginComposerModalProps = {
  entry: PluginComposerEntry; scope: PluginHostScope; locale: string; source?: PluginSource | null; attachmentId?: string;
  valid(): boolean; commit(image: File, source: PluginSource, replaceAttachmentId?: string): string;
  settings?(): Promise<unknown>; onClosed(reason: PluginEndReason): void;
};
export function PluginComposerModal(props: PluginComposerModalProps) {
  const environment = usePluginSurfaceEnvironment(), t = useComposerTranslation(props.locale);
  const session = useRef<PluginComposerSession | null>(null), latest = useRef(props); useLayoutEffect(() => { latest.current = props; }, [props]);
  const [source] = useState(props.source);
  const liveness = useRef({ ready: false, retired: false, activity: 0, tick: 0 });
  useLayoutEffect(() => { liveness.current.activity = performance.now(); liveness.current.tick = performance.now(); }, []);
  const [retired, setRetired] = useState(false);
  const [status, setStatus] = useState('loading'), [dirty, setDirty] = useState(false);
  const [theme,setTheme]=useState<'light'|'dark'>(()=>document.documentElement.classList.contains('dark')?'dark':'light');
  const preferences=useMemo(()=>({locale:props.locale,theme}),[props.locale,theme]);
  useEffect(()=>{const observer=new MutationObserver(()=>setTheme(document.documentElement.classList.contains('dark')?'dark':'light'));observer.observe(document.documentElement,{attributes:true,attributeFilter:['class']});return()=>observer.disconnect();},[]);
  const createDispatch = useCallback((identity: { generationId: string; sourceFormat: PluginSourceFormat }) => {
    if (liveness.current.retired) throw new Error('PLUGIN_OWNER_EXPIRED');
    liveness.current.ready = false; liveness.current.activity = performance.now();
    if (!environment) throw new Error('PLUGIN_SURFACE_UNAVAILABLE');
    const previous = session.current;
    if (previous) void previous.end('generation').catch(() => {});
    const current: PluginComposerSession = new PluginComposerSession({ pluginId: props.entry.id, generationId: identity.generationId, format: identity.sourceFormat,
      locale: latest.current.locale, source, attachmentId: props.attachmentId, recovery: recoveryForScope(environment, { ...props.scope, pluginId: props.entry.id, attachmentId:props.attachmentId }),
      valid: () => latest.current.valid() && session.current === current,
      commit: (image, source, replaceId) => latest.current.commit(image, source, replaceId),
      settings: () => latest.current.settings?.() ?? Promise.resolve({}), dirty: setDirty, closed: reason => latest.current.onClosed(reason) });
    session.current = current;
    return (operation: string, payload: unknown, signal?: AbortSignal) => {
      // Authenticated requests prove liveness even when a published session rejects a heartbeat.
      if (session.current === current && !liveness.current.retired) liveness.current.activity = performance.now();
      return current.request(operation, payload, signal);
    };
  }, [environment, props.entry.id, source, props.attachmentId, props.scope]);
  const onStatus = useCallback((value: string) => {
    if (liveness.current.retired) return;
    liveness.current.ready = value === 'ready';
    liveness.current.activity = performance.now();
    setStatus(value);
  }, []);
  const close = useCallback(() => {
    void session.current?.end('crash').catch(() => {});
    latest.current.onClosed('crash');
  }, []);
  useEffect(() => {
    const grace = () => { liveness.current.activity = liveness.current.tick = performance.now(); };
    document.addEventListener('visibilitychange', grace);
    const timer = window.setInterval(() => {
      const clock = liveness.current, now = performance.now(), elapsed = now - clock.tick;
      clock.tick = now;
      if (document.visibilityState !== 'visible' || elapsed > PLUGIN_SURFACE_LIVENESS.heartbeatMs * 2) { clock.activity = now; return; }
      if (!clock.ready || clock.retired || now - clock.activity < PLUGIN_SURFACE_LIVENESS.timeoutMs) return;
      clock.retired = true; clock.ready = false;
      // End revokes authority synchronously; pending storage must not retain the frame or block Close.
      void session.current?.end('crash').catch(() => {});
      setRetired(true); setStatus('unresponsive');
    }, PLUGIN_SURFACE_LIVENESS.heartbeatMs);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', grace); };
  }, []);
  const beforeEnd = useCallback(async (reason: PluginEndReason) => { await session.current?.end(reason); }, []);
  useEffect(() => () => { void session.current?.end('crash').catch(() => {}); session.current = null; }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  if (!environment) return null;
  const Surface = environment.Surface, failed = !['loading', 'ready'].includes(status);
  const size = 'min(720px, calc(100vw - 48px), calc(100dvh - 48px))';
  return <Dialog open onOpenChange={() => {}}><AppDialogContent showCloseButton={false}
    data-plugin-composer-dialog aria-describedby={undefined} className="gap-0 p-0"
    style={{ width: size, height: size, maxWidth: size, maxHeight: size }}
    onPointerDownOutside={event => event.preventDefault()} onInteractOutside={event => event.preventDefault()}
    onEscapeKeyDown={event => { event.preventDefault(); if (status !== 'ready') close(); }}>
    <DialogTitle className="sr-only">{props.entry.name}</DialogTitle>
    {!retired && <Surface preferences={preferences} entry={props.entry} scope={props.scope} createDispatch={createDispatch} beforeEnd={beforeEnd} onStatus={onStatus} />}
    {status !== 'ready' && <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-background/95 p-6" role="status">
      <p>{status === 'unresponsive' ? t('sketch.unresponsive') : failed ? t('sketch.error') : t('sketch.processing')}</p>
      <button className="rounded-md border px-4 py-2" onClick={close}>{t('common.close')}</button>
    </div>}
  </AppDialogContent></Dialog>;
}
