/**
 * [INPUT]: Depends on Main-held candidate review revisions, typed per-instance forms and the shared confirmation dialog.
 * [OUTPUT]: Provides WidgetUpdateReviewDialog with retained independent drafts, explicit stale-preview conflicts and one final source application.
 * [POS]: Shared source/version review; no form changes a running instance or grants another instance access.
 */
import {useRef,useState} from 'react';
import {Dialog,DialogContent,DialogTitle,DialogDescription,DialogFooter} from '@ai-chat/ui/components/ui/dialog';
import {defaultDockSettings} from '@bottega/contracts/plugins/dock/settings';
import {useAppTranslation} from '@/components/providers/preferences/i18n-provider';
import {SettingsAlert,SettingsButton} from '@/components/settings/settings-layout';
import type {WidgetApplyInput,WidgetApplyReceipt,WidgetPreview} from '../../../../../../shared/system-dock/widgets/authoring';
import type {WidgetUpdateReview} from '../../../../../../shared/system-dock/widgets/review';
import type {WidgetInstanceForm} from '../../../../../../shared/system-dock/widgets/management';
import {WidgetConfiguration,type WidgetConfigurationDraft} from '../configure';
export function WidgetUpdateReviewDialog({preview,initial,onSubmit,onClose,onApplied,onReturnFocus}:{preview:WidgetPreview;initial:WidgetUpdateReview;
 onSubmit(input:WidgetApplyInput):Promise<WidgetApplyReceipt>;onClose():void;onApplied():void;onReturnFocus():void}){
 const {t}=useAppTranslation(),[review,setReview]=useState(initial),[form,setForm]=useState<WidgetInstanceForm|null>(null),[drafts,setDrafts]=useState<Record<string,WidgetConfigurationDraft>>({}),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false),[result,setResult]=useState<'conflict'|'pending'|null>(null),lock=useRef(false),operation=useRef<WidgetApplyInput|null>(null);
 const open=async(itemId:string)=>{
  if(lock.current)return;lock.current=true;setBusy(true);setFailed(false);
  try{const value=await window.systemDockSettings!.widgetUpdateForm({previewId:preview.previewId,itemId});setDrafts(previous=>({...previous,[itemId]:previous[itemId]??{name:value.name,size:value.widget.size,settings:value.widget.settings,bindings:[...value.widget.bindings],baseConsent:value.baseAuthorized}}));setForm(value);}
  catch(error){if(/CONFLICT|EXPIRED/.test(String(error)))setResult('conflict');else setFailed(true);}finally{lock.current=false;setBusy(false);}
 };
 const apply=async()=>{
  if(lock.current||!review.complete)return;lock.current=true;setBusy(true);setFailed(false);setResult(null);
  operation.current??={operationId:crypto.randomUUID(),previewId:preview.previewId,reviewId:review.reviewId,settings:defaultDockSettings(preview.dock.settings),bindings:[],size:preview.dock.sizes[0]!};
  try{const receipt=await onSubmit(operation.current);if(receipt.status==='applied'||receipt.status==='saved')onApplied();else setResult(receipt.status==='conflict'?'conflict':'pending');}
  catch(error){if(/CONFLICT|EXPIRED/.test(String(error)))setResult('conflict');else setFailed(true);}finally{lock.current=false;setBusy(false);}
 };
 if(form)return <WidgetConfiguration preview={form} draft={drafts[form.itemId!]!} onDraft={draft=>setDrafts(previous=>({...previous,[form.itemId!]:draft}))} kind="review" onClose={()=>setForm(null)} onReturnFocus={()=>requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>(`[data-widget-update-item="${form.itemId}"] button`)?.focus())}
  onSubmit={async input=>{const next=await window.systemDockSettings!.stageWidgetUpdate({...input,itemId:form.itemId!,expectedMappingRevision:form.mappingRevision});setReview(next);operation.current=null;setResult(null);return'success';}}/>;
 return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent showCloseButton={!busy} className="max-h-[85vh] overflow-y-auto" onCloseAutoFocus={event=>{event.preventDefault();onReturnFocus();}} onEscapeKeyDown={event=>{if(busy)event.preventDefault();}}>
  <DialogTitle>{t('systemDock.widgets.review.title')}</DialogTitle><DialogDescription>{t('systemDock.widgets.review.hint')}</DialogDescription>
  <ul className="grid gap-3">{review.items.map(item=><li key={item.itemId} data-widget-update-item={item.itemId} className="flex items-center justify-between gap-3 rounded-md border p-3">
   <div className="min-w-0 text-sm"><p className="truncate">{item.name}</p><p className="text-xs text-muted-foreground">{t(item.configurationRequired?'systemDock.widgets.review.configuration':item.authorizationRequired?'systemDock.widgets.review.authorization':item.reviewed?'systemDock.widgets.review.reviewed':'systemDock.widgets.review.ready')}</p></div>
   <SettingsButton variant="outline" disabled={busy} onClick={()=>void open(item.itemId)}>{t('systemDock.widgets.configure')}</SettingsButton>
  </li>)}</ul>
  {(failed||result)&&<SettingsAlert>{t(result==='conflict'?'systemDock.widgets.conflict':result==='pending'?'systemDock.widgets.commitPending':'systemDock.widgets.applyFailed')}</SettingsAlert>}
  <DialogFooter><SettingsButton variant="outline" disabled={busy} onClick={onClose}>{t('systemDock.widgets.cancel')}</SettingsButton><SettingsButton disabled={busy||!review.complete||result==='conflict'} aria-busy={busy} onClick={()=>void apply()}>{t(busy?'systemDock.widgets.applying':preview.instanceIds.length===1?'systemDock.widgets.applyOne':'systemDock.widgets.applyMany',{count:preview.instanceIds.length})}</SettingsButton></DialogFooter>
 </DialogContent></Dialog>;
}
