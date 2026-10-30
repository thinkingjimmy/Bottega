/**
 * [INPUT]: Depends on trusted version metadata/previews, exact host summaries and explicit operation-bound application.
 * [OUTPUT]: Provides historical preview, compatible rollback/forward, individually staged incompatible repairs and honest saved/pending/conflict results.
 * [POS]: Settings version review; selecting a row never changes a running generation or instance.
 */
import {useEffect,useRef,useState} from 'react';
import {Dialog,DialogContent,DialogTitle,DialogDescription,DialogFooter} from '@ai-chat/ui/components/ui/dialog';
import {defaultDockSettings} from '@bottega/contracts/plugins/dock/settings';
import type {DockSummarySize} from '@bottega/contracts/plugins/dock/geometry';
import type {WidgetVersionView,WidgetPreview,WidgetApplyInput} from '../../../../../shared/system-dock/widgets/authoring';
import {SettingsAlert,SettingsButton} from '@/components/settings/settings-layout';
import {useAppTranslation} from '@/components/providers/preferences/i18n-provider';
import {effectiveLocale} from '@/lib/appearance/i18n-locale';
import {WidgetSummaryPreview} from './preview';
import type {WidgetUpdateReview} from '../../../../../shared/system-dock/widgets/review';
import {WidgetUpdateReviewDialog} from './review';
export function WidgetVersionsDialog({definitionId,onClose,onChanged,onReturnFocus}:{definitionId:string;onClose():void;onChanged():void;onReturnFocus():void}){
 const {t}=useAppTranslation(),[versions,setVersions]=useState<readonly WidgetVersionView[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false);
 const [preview,setPreview]=useState<WidgetPreview|null>(null),[result,setResult]=useState<'conflict'|'pending'|null>(null),[edge,setEdge]=useState<'bottom'|'left'|'right'>('bottom'),[size,setSize]=useState<DockSummarySize>('small'),lock=useRef(false),operation=useRef<WidgetApplyInput|null>(null);
 const [review,setReview]=useState<WidgetUpdateReview|null>(null);
 useEffect(()=>{let alive=true;void window.systemDockSettings!.widgetVersions({definitionId}).then(value=>{if(alive){setVersions(value);setLoading(false);}},()=>{if(alive){setFailed(true);setLoading(false);}});return()=>{alive=false;};},[definitionId]);
 const select=async(generationId:string)=>{
  if(lock.current)return;lock.current=true;setBusy(true);setFailed(false);setResult(null);operation.current=null;
  try{const next=await window.systemDockSettings!.previewWidgetVersion({definitionId,generationId});setPreview(next);setSize(next.dock.sizes[0]!);}catch{setFailed(true);}finally{lock.current=false;setBusy(false);}
 };
 const apply=async()=>{
  if(lock.current||!preview)return;lock.current=true;setBusy(true);setFailed(false);setResult(null);
  try{
   if(preview.mode==='update'&&!operation.current){const value=await window.systemDockSettings!.widgetUpdateReview({previewId:preview.previewId});if(!value.complete){setReview(value);return;}}
   operation.current??={operationId:crypto.randomUUID(),previewId:preview.previewId,settings:defaultDockSettings(preview.dock.settings),bindings:[],size};
   const receipt=await window.systemDockSettings!.applyWidget(operation.current);onChanged();if(receipt.status==='applied'||receipt.status==='saved')onClose();else setResult(receipt.status==='conflict'?'conflict':'pending');}
  catch{setFailed(true);}finally{lock.current=false;setBusy(false);}
 };
 if(review&&preview)return <WidgetUpdateReviewDialog preview={preview} initial={review} onSubmit={async input=>{const receipt=await window.systemDockSettings!.applyWidget(input);onChanged();return receipt;}} onClose={()=>setReview(null)} onApplied={onClose} onReturnFocus={onReturnFocus}/>;
 return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent showCloseButton={!busy} className="max-h-[85vh] overflow-y-auto" onEscapeKeyDown={event=>{if(busy)event.preventDefault();}} onCloseAutoFocus={event=>{event.preventDefault();onReturnFocus();}}>
  <DialogTitle>{t('systemDock.widgets.versionTitle')}</DialogTitle><DialogDescription>{t('systemDock.widgets.versionHint')}</DialogDescription>
  {loading?<p role="status">{t('settings.presence.preparing')}</p>:<ul className="max-h-52 space-y-2 overflow-y-auto">{versions.map(version=><li key={version.generationId} data-widget-version={version.generationId} className="flex items-center justify-between gap-3 rounded-md border p-3">
   <div className="min-w-0 text-sm"><p>{version.version}{version.active?' · '+t('systemDock.widgets.currentVersion'):''}</p><time className="text-xs text-muted-foreground" dateTime={new Date(version.createdAt).toISOString()}>{new Intl.DateTimeFormat(effectiveLocale(),{dateStyle:'medium',timeStyle:'short'}).format(version.createdAt)}</time></div>
   <SettingsButton variant="outline" disabled={busy||!version.available} onClick={()=>void select(version.generationId)}>{t('systemDock.widgets.previewVersion')}</SettingsButton>
  </li>)}</ul>}
  {preview&&<><p className="text-xs text-muted-foreground">{t('systemDock.widgets.impact',{count:preview.instanceIds.length})}</p><WidgetSummaryPreview dock={preview.dock} edge={edge} size={size} onEdge={setEdge} onSize={setSize}/></>}
  {(failed||result)&&<SettingsAlert>{t(result==='conflict'?'systemDock.widgets.conflict':result==='pending'?'systemDock.widgets.commitPending':'systemDock.widgets.applyFailed')}</SettingsAlert>}
  <DialogFooter><SettingsButton variant="outline" disabled={busy} onClick={onClose}>{t('systemDock.widgets.cancel')}</SettingsButton>
   {preview&&preview.mode!=='applied'&&<SettingsButton disabled={busy||failed} aria-busy={busy} onClick={()=>void apply()}>{t(busy?'systemDock.widgets.applying':preview.mode==='save'?'systemDock.widgets.saveVersion':preview.instanceIds.length===1?'systemDock.widgets.applyOne':'systemDock.widgets.applyMany',{count:preview.instanceIds.length})}</SettingsButton>}
  </DialogFooter>
 </DialogContent></Dialog>;
}
