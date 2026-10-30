/**
 * [INPUT]: Depends on the fixed Dock bridge, source Chat identity, lazy Dock copy and the host summary interpreter.
 * [OUTPUT]: Provides fixed Widget authoring, sealed samples, explicit temporary real/native preview, visible failure/retry, original-operation recovery and independent candidate repair before manual application.
 * [POS]: Chat authoring context outside the transcript scroll; real preview has separate temporary consent and never applies a candidate or starts an Agent.
 */
import {lazy,Suspense,useCallback,useEffect,useRef,useState} from 'react';
import {useAppTranslation} from '@/components/providers/preferences/i18n-provider';
import {useDockWidgets} from '@/lib/platform/dock-widgets/client';
import {effectiveLocale} from '@/lib/appearance/i18n-locale';
import {loadSection} from '../../../../shared/i18n/sections';
import type {WidgetPreview,WidgetApplyInput,WidgetApplyReceipt} from '../../../../shared/system-dock/widgets/authoring';
import {defaultDockSettings} from '@bottega/contracts/plugins/dock/settings';
import {WidgetConfiguration,widgetConfigurationDraft,type WidgetConfigurationDraft} from '@/components/settings/dock/widgets/configure';
import {WidgetSummaryPreview} from '@/components/settings/dock/widgets/preview';
import type {DockSummarySize} from '@bottega/contracts/plugins/dock/geometry';
import type {WidgetUpdateReview} from '../../../../shared/system-dock/widgets/review';
import {WidgetUpdateReviewDialog} from '@/components/settings/dock/widgets/review';
const WidgetPreviewDialog=lazy(()=>import('@/components/settings/dock/widgets/preview/dialog').then(module=>({default:module.WidgetPreviewDialog})));
export function WidgetAuthoring({definitionId,chatId}:{definitionId:string;chatId:string}){
  const {t,i18n}=useAppTranslation(),state=useDockWidgets(),locale=effectiveLocale();
  const definition=state.snapshot?.definitions.find(item=>item.id===definitionId),[readyLocale,setReadyLocale]=useState<string|null>(null),[storedPreview,setPreview]=useState<WidgetPreview|null>(null),[building,setBuilding]=useState(false),[applying,setApplying]=useState(false),[failed,setFailed]=useState(false);
  const [result,setResult]=useState<WidgetApplyReceipt|null>(null),[applyFailure,setApplyFailure]=useState<'conflict'|'failed'|null>(null),[configure,setConfigure]=useState<WidgetPreview|null>(null),[draft,setDraft]=useState<WidgetConfigurationDraft|null>(null);
  const [review,setReview]=useState<Readonly<{preview:WidgetPreview;status:WidgetUpdateReview}>|null>(null);
  const [detailedPreview,setDetailedPreview]=useState<WidgetPreview|null>(null),previewButton=useRef<HTMLButtonElement>(null);
  const [edge,setEdge]=useState<'bottom'|'left'|'right'>('bottom'),[size,setSize]=useState<DockSummarySize>('small'),lock=useRef(false),alive=useRef(true),application=useRef<WidgetApplyInput|null>(null),buildButton=useRef<HTMLButtonElement>(null);
  const receivedGeneration=useRef<string|null>(null),receivePreview=useCallback((value:WidgetPreview)=>{
    setPreview(value);setFailed(false);const previous=value.replacement?.item.widget;
    if(receivedGeneration.current!==value.generationId&&previous?.type==='custom'&&value.dock.sizes.includes(previous.size))setSize(previous.size);
    receivedGeneration.current=value.generationId;
  },[setPreview,setSize]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{let active=true;void loadSection('systemDock',locale).then(()=>{if(active)setReadyLocale(locale);},()=>{if(active)setFailed(true);});return()=>{active=false;};},[locale,i18n.language]);
  useEffect(()=>{
    if(!definition?.candidateGenerationId)return;let active=true;
    void window.systemDockSettings?.widgetPreview({definitionId}).then(value=>{if(active)receivePreview(value);},()=>{if(active){setPreview(null);setFailed(true);}});return()=>{active=false;};
  },[definitionId,definition?.candidateGenerationId,definition?.activeGenerationId,definition?.error,state.snapshot?.layoutRevision,receivePreview]);
  if(readyLocale!==locale||!definition)return null;
  const preview=storedPreview?.generationId===definition.candidateGenerationId&&!definition.error?storedPreview:null;
  const build=async()=>{if(lock.current||!window.systemDockSettings)return;lock.current=true;setBuilding(true);setFailed(false);setApplyFailure(null);setResult(null);
    try{const next=await window.systemDockSettings.buildWidget({definitionId});if(alive.current){receivePreview(next);state.refresh();}}
    catch{if(alive.current)setFailed(true);}finally{lock.current=false;if(alive.current)setBuilding(false);}};
  const outcome=(value:WidgetApplyReceipt)=>{if(alive.current){setResult(value);state.refresh();}};
  const apply=async()=>{
    if(lock.current||!preview||!window.systemDockSettings)return;
    lock.current=true;setApplying(true);setApplyFailure(null);setResult(null);
    try{
      if(application.current&&application.current.previewId!==preview.previewId){
        const previous=await window.systemDockSettings.widgetOperation({operationId:application.current.operationId});
        if(!previous||previous.status==='saved-not-added'){
          try{outcome(await window.systemDockSettings.applyWidget(application.current));return;}
          catch(error){if(!/DOCK_PREVIEW_(?:CONFLICT|EXPIRED)|DOCK_WIDGET_ALREADY_APPLIED|DOCK_OPERATION_CONFLICT/.test(String(error)))throw error;}
        }
        application.current=null;
      }
      if(preview.mode==='add'||preview.mode==='replace'&&preview.dock.data.some(source=>source.kind==='base')){const prior=preview.replacement?.item.widget;setDraft({...widgetConfigurationDraft(preview,draft??(prior?.type==='custom'?{name:preview.name,size:prior.size,settings:prior.settings,bindings:prior.bindings,baseConsent:false}:null)),size:selected});setConfigure(preview);return;}
      if(preview.mode==='update'&&!application.current){const value=await window.systemDockSettings.widgetUpdateReview({previewId:preview.previewId});if(!value.complete){setReview({preview,status:value});return;}}
      application.current??={operationId:crypto.randomUUID(),previewId:preview.previewId,settings:defaultDockSettings(preview.dock.settings),bindings:[],size:selected};
      outcome(await window.systemDockSettings.applyWidget(application.current));
    }catch(error){if(alive.current)setApplyFailure(/CONFLICT|EXPIRED/.test(String(error))?'conflict':'failed');}finally{lock.current=false;if(alive.current)setApplying(false);}
  };
  const selected=preview?.dock.sizes.includes(size)?size:preview?.dock.sizes[0]??'small';
  return <section data-widget-authoring="" data-widget-definition={definitionId} className="shrink-0 border-b bg-background px-4 py-3">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><h2 className="truncate text-sm font-semibold">{definition.name}</h2><p className="text-xs text-muted-foreground">{t(preview?'systemDock.widgets.candidate':'systemDock.widgets.draft')} · {t('systemDock.widgets.impact',{count:preview?.mode==='replace'?1:definition.instanceCount})}</p></div>
      <div className="flex flex-wrap gap-2"><button ref={buildButton} type="button" disabled={building||applying} aria-busy={building} onClick={()=>void build()} className="min-h-9 rounded-md border px-3 text-xs hover:bg-muted disabled:opacity-50">{t(building?'systemDock.widgets.building':'systemDock.widgets.build')}</button>
      {preview&&<button ref={previewButton} type="button" aria-haspopup="dialog" disabled={building||applying||definition.chatId!==chatId||preview.layoutRevision!==state.snapshot?.layoutRevision} onClick={()=>setDetailedPreview(preview)} className="min-h-9 rounded-md border px-3 text-xs hover:bg-muted disabled:opacity-50">{t('systemDock.widgets.previewDetails')}</button>}
      {preview&&preview.mode!=='applied'&&<button type="button" disabled={building||applying||preview.layoutRevision!==state.snapshot?.layoutRevision} aria-busy={applying} onClick={()=>void apply()} className="min-h-9 rounded-md bg-primary px-3 text-xs text-primary-foreground disabled:opacity-50">{t(applying?'systemDock.widgets.applying':preview.mode==='replace'?'systemDock.widgets.replaceWithCopy':preview.mode==='add'?'systemDock.widgets.saveAndAdd':preview.mode==='save'?'systemDock.widgets.saveVersion':preview.instanceIds.length===1?'systemDock.widgets.applyOne':'systemDock.widgets.applyMany',{count:preview.instanceIds.length})}</button>}</div></div>
    <p className="mt-2 text-xs text-muted-foreground">{t('systemDock.widgets.describe')}</p>
    {preview?.mode==='replace'&&<p className="mt-2 text-xs text-muted-foreground">{t('systemDock.widgets.preserveInstance')}</p>}
    {(failed||definition.error)&&<p role="alert" className="mt-2 text-xs text-destructive">{t('systemDock.widgets.buildFailed')}</p>}
    {applyFailure&&<p role="alert" className="mt-2 text-xs text-destructive">{t(applyFailure==='conflict'?'systemDock.widgets.conflict':'systemDock.widgets.applyFailed')}</p>}
    {result?.status==='conflict'&&<p role="alert" className="mt-2 text-xs text-destructive">{t('systemDock.widgets.conflict')}</p>}
    {result?.status==='saved-not-added'&&<p role="status" className="mt-2 text-xs text-muted-foreground">{t('systemDock.widgets.commitPending')}</p>}
    {((result?.status==='applied'||result?.status==='saved')&&result.activeGenerationId===preview?.generationId||preview?.mode==='applied')&&<p role="status" className="mt-2 text-xs text-muted-foreground">{t(result?.status==='saved'||(!result&&preview?.instanceIds.length===0)?'systemDock.widgets.versionSaved':'systemDock.widgets.applied')}</p>}
    {preview&&<WidgetSummaryPreview dock={preview.dock} edge={edge} size={selected} onEdge={setEdge} onSize={setSize}/>}
    {detailedPreview&&<Suspense fallback={null}><WidgetPreviewDialog preview={detailedPreview} chatId={chatId} instances={state.snapshot?.instances} onClose={()=>setDetailedPreview(null)} onReturnFocus={()=>requestAnimationFrame(()=>previewButton.current?.focus())}/></Suspense>}
    {configure&&draft&&<WidgetConfiguration preview={configure} draft={draft} onDraft={setDraft} onSubmit={async input=>{const value=await window.systemDockSettings!.applyWidget(input);outcome(value);return value.status==='applied'||value.status==='saved'?'success':value.status==='conflict'?'conflict':'pending';}} onClose={()=>setConfigure(null)} onReturnFocus={()=>requestAnimationFrame(()=>buildButton.current?.focus())} />}
    {review&&<WidgetUpdateReviewDialog preview={review.preview} initial={review.status} onSubmit={async input=>{const value=await window.systemDockSettings!.applyWidget(input);outcome(value);return value;}} onClose={()=>setReview(null)} onApplied={()=>setReview(null)} onReturnFocus={()=>requestAnimationFrame(()=>buildButton.current?.focus())}/>}
  </section>;
}
