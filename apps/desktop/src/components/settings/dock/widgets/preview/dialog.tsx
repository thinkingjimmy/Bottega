/**
 * [INPUT]: Depends on a held preview, exact temporary session, shared summary/data rendering and independent host configuration.
 * [OUTPUT]: Provides WidgetPreviewDialog for marked samples, explicit real consent, native isolation, dry-run actions and host refresh.
 * [POS]: Main authoring preview; layout, saved instances, source activation and other grants remain owned by their existing flows.
 */
import {useCallback,useRef,useState,type CSSProperties} from 'react';
import {Dialog,DialogTitle,DialogDescription,DialogHeader,DialogFooter} from '@ai-chat/ui/components/ui/dialog';
import {AppDialogContent,AppDialogBody} from '@ai-chat/ui/components/ui/app-dialog';
import type {DockSummarySize} from '@bottega/contracts/plugins/dock/geometry';
import type {WidgetPreview} from '../../../../../../shared/system-dock/widgets/authoring';
import {useAppTranslation} from '@/components/providers/preferences/i18n-provider';
import {SettingsButton,SettingsAlert} from '@/components/settings/settings-layout';
import {effectiveLocale} from '@/lib/appearance/i18n-locale';
import {WidgetDataCards} from '@/system-dock/common/widgets/data';
import {WidgetSummaryPreview} from '../preview';
import {WidgetConfiguration,widgetConfigurationDraft,type WidgetConfigurationDraft} from '../configure';
import {useWidgetPreviewSession} from './session';
import {useWidgetPreviewVisibility} from './visibility';
import {WidgetPreviewNative} from './native';
export function WidgetPreviewDialog({preview,chatId,instances=[],onClose,onReturnFocus}:{preview:WidgetPreview;chatId:string;instances?:readonly{id:string;name:string}[];onClose():void;onReturnFocus():void}){
 const {t}=useAppTranslation(),content=useRef<HTMLDivElement>(null),[targetId,setTarget]=useState(preview.instanceIds[0]),[edge,setEdge]=useState<'bottom'|'left'|'right'>('bottom'),[size,setSize]=useState<DockSummarySize>(preview.dock.sizes[0]!),[configuration,setConfiguration]=useState(false),[draft,setDraft]=useState<WidgetConfigurationDraft|null>(null),[busy,setBusy]=useState(false),[failure,setFailure]=useState(false),lock=useRef(false);
 const [host,setHost]=useState<HTMLDivElement|null>(null),attach=useCallback((node:HTMLDivElement|null)=>{content.current=node;setHost(node);},[setHost]);
 const configured=useRef(false),startingReal=useRef(false),session=useWidgetPreviewSession(preview,chatId,targetId,onClose),value=session.snapshot,detail=value?.detail;
 useWidgetPreviewVisibility(host,configuration?undefined:value?.sessionId,session.control);
 const close=()=>{void session.stop().catch(()=>{});onClose();};
 const real=async()=>{if(lock.current)return;lock.current=true;setBusy(true);setFailure(false);startingReal.current=false;try{await session.stop();const saved=draft??await session.draft();setDraft({...widgetConfigurationDraft(preview,saved),baseConsent:false});configured.current=true;setConfiguration(true);}catch{setFailure(true);}finally{lock.current=false;setBusy(false);}};
 const refresh=async()=>{if(lock.current||!value)return;lock.current=true;setBusy(true);setFailure(false);try{await session.control({kind:'refresh',sessionId:value.sessionId});}catch{setFailure(true);}finally{lock.current=false;setBusy(false);}};
 if(configuration&&draft)return <WidgetConfiguration preview={{...preview,itemId:targetId}} draft={draft} onDraft={setDraft} kind="preview" onSubmit={async input=>{await session.start('real',{name:input.name??draft.name,size:input.size,settings:input.settings,bindings:input.bindings,baseConsent:input.baseConsent??false,apiConsent:input.apiConsent??[]},input.operationId);startingReal.current=true;return'success';}} onClose={()=>{configured.current=false;setConfiguration(false);if(!startingReal.current)void session.start('sample').catch(()=>{});}} onReturnFocus={()=>requestAnimationFrame(()=>content.current?.focus())}/>;
 const readings=detail?Object.fromEntries(detail.data.map(source=>[source.id,source.reading])):value?{}:undefined,selectedTheme=value?.theme??'light';
 return <Dialog open onOpenChange={open=>{if(!open)close();}}><AppDialogContent ref={attach} showCloseButton={false} className="sm:max-w-3xl" onCloseAutoFocus={event=>{event.preventDefault();if(!configured.current)onReturnFocus();}}>
  <DialogHeader><DialogTitle>{t('systemDock.widgets.previewTitle')}</DialogTitle><DialogDescription>{value?t('systemDock.widgets.previewExecution',{computer:value.executionComputer}):t('systemDock.widgets.previewHint')}</DialogDescription></DialogHeader>
  <div data-widget-live-preview="" data-widget-preview-session={value?.sessionId} data-preview-state={value?.state??'loading'} className="flex min-h-0 flex-1 flex-col gap-3">
   {preview.instanceIds.length>1&&<label className="mt-3 grid gap-1 text-sm">{t('systemDock.widgets.previewTarget')}<select disabled={busy||session.loading} value={targetId} onChange={event=>{setDraft(null);setTarget(event.target.value);}} className="min-h-9 rounded border bg-transparent px-2">{preview.instanceIds.map(id=><option key={id} value={id}>{instances.find(instance=>instance.id===id)?.name??preview.name}</option>)}</select></label>}
   <WidgetSummaryPreview dock={preview.dock} edge={edge} size={size} onEdge={setEdge} onSize={setSize} readings={readings} example={value?.mode!=='real'} theme={selectedTheme} onTheme={theme=>{if(value)void session.control({kind:'theme',sessionId:value.sessionId,theme}).catch(()=>{});}}/>
   <AppDialogBody data-preview-scroll="" className="min-h-0 flex-1 rounded-lg border" style={{colorScheme:selectedTheme,background:'light-dark(#f3f3f5, #26262a)',color:'light-dark(#1d1d1f, #f4f4f6)','--border':'light-dark(rgb(0 0 0 / 0.1), rgb(255 255 255 / 0.12))'}as CSSProperties}>
    {session.loading&&<p role="status" className="p-4 text-sm">{t('systemDock.widgets.states.loading')}</p>}
    {value?.state==='suspended'&&<p role="status" className="p-4 text-sm">{t('systemDock.widgets.previewSuspended')}</p>}
    {value?.state==='closed'&&<p role="status" className="p-4 text-sm">{t('systemDock.widgets.previewEnded')}</p>}
    {detail?.surface?<WidgetPreviewNative sessionId={value!.sessionId} surface={detail.surface} send={session.control}/>:detail?<WidgetDataCards data={detail.data} locale={effectiveLocale()} t={t}/>:null}
   </AppDialogBody>
   {value?.announcement&&<p role="status" className="text-xs text-muted-foreground">{t('systemDock.widgets.previewAction')}</p>}
   {detail&&<div className="flex flex-wrap gap-2">{detail.actions.map(action=><SettingsButton key={action.ref} variant="outline" disabled={busy} onClick={()=>void session.control({kind:'action',sessionId:value!.sessionId,ref:action.ref}).catch(()=>{})}>{action.label}</SettingsButton>)}</div>}
   {(failure||session.failed)&&<SettingsAlert>{t('systemDock.widgets.previewFailed')}</SettingsAlert>}
   <DialogFooter className="flex-wrap gap-2 pt-3"><SettingsButton variant="outline" onClick={close}>{t('systemDock.widgets.previewClose')}</SettingsButton><SettingsButton variant="outline" disabled={busy||session.loading||value?.state==='closed'} onClick={()=>void real()}>{t('systemDock.widgets.previewUseReal')}</SettingsButton>
    {value?.mode==='real'&&<SettingsButton disabled={busy||value.state!=='active'} aria-busy={busy} onClick={()=>void refresh()}>{t('systemDock.widgets.previewRefresh')}</SettingsButton>}
   </DialogFooter>
  </div>
 </AppDialogContent></Dialog>;
}
