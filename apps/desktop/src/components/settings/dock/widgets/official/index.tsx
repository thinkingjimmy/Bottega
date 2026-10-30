/**
 * [INPUT]: Depends on main-owned official form receipts, existing quota period labels and accessible Settings/Dialog controls.
 * [OUTPUT]: Provides explicit official additions and individual configuration with retained input and stable retry identity.
 * [POS]: Common Settings/Dock host confirmation; it creates no source Chat, plugin generation or data consumer.
 */
import {useRef,useState} from 'react';
import {Dialog,DialogContent,DialogTitle,DialogDescription,DialogFooter} from '@ai-chat/ui/components/ui/dialog';
import {backendLabel} from '@ai-chat/ui/components/identity/agent';
import {widgetNameSchema} from '@bottega/contracts/plugins/dock/settings';
import type {OfficialWidgetForm,OfficialWidget,SubmitOfficialWidget} from '../../../../../../shared/system-dock/widgets/official';
import type {AgentBackendId} from '../../../../../../shared/ipc/agent/agent-ipc';
import {SettingsAlert,SettingsButton} from '@/components/settings/settings-layout';
import {useAppTranslation} from '@/components/providers/preferences/i18n-provider';
import {quotaPeriod} from '@/lib/usage-limits/format';
function OfficialControls({form,widget,disabled,onChange}:{form:OfficialWidgetForm;widget:OfficialWidget;disabled:boolean;onChange(value:OfficialWidget):void}){
 const {t}=useAppTranslation();
 if(widget.type==='builtin.tasks')return null;
 if(widget.type==='builtin.ai-activity')return <div className="grid gap-2 text-sm"><label htmlFor={form.previewId+'-source'}>{t('systemDock.widgets.usageSource')}</label><select id={form.previewId+'-source'} className="min-h-10 rounded-md border bg-transparent px-3" disabled={disabled} value={widget.source} onChange={event=>onChange({...widget,source:event.target.value as typeof widget.source})}>
  <option value="all">{t('systemDock.widgets.allAgents')}</option>{[...new Set([...form.sources,widget.source])].filter(source=>source!=='all').map(source=><option key={source} value={source}>{backendLabel(source)}</option>)}
 </select></div>;
 const toggle=(backend:AgentBackendId,enabled:boolean)=>{const selectionByBackend={...widget.selectionByBackend};if(!enabled)delete selectionByBackend[backend];onChange({...widget,selectedBackends:enabled?[...widget.selectedBackends,backend]:widget.selectedBackends.filter(value=>value!==backend),selectionByBackend});};
 const move=(backend:AgentBackendId,offset:number)=>{const selectedBackends=[...widget.selectedBackends],index=selectedBackends.indexOf(backend),next=index+offset;if(index<0||next<0||next>=selectedBackends.length)return;selectedBackends.splice(index,1);selectedBackends.splice(next,0,backend);onChange({...widget,selectedBackends});};
 const pick=(backend:AgentBackendId,value:string)=>{const selectionByBackend={...widget.selectionByBackend};if(!value)delete selectionByBackend[backend];else{const [poolId,windowId]=JSON.parse(value)as[string|null,string|null];selectionByBackend[backend]={poolId,windowId};}onChange({...widget,selectionByBackend});};
 const windowOptions=(backend:AgentBackendId)=>form.agents.find(agent=>agent.backend===backend)?.pools.flatMap(pool=>{
  const name=pool.label??t('settings.usage.limits.general');return[{value:JSON.stringify([pool.id,null]),label:name+' · '+t('systemDock.limits.automatic')},...pool.windows.map(window=>({value:JSON.stringify([pool.id,window.id]),label:name+' · '+quotaPeriod({...window,usedPercent:null,resetsAt:null,receivedAt:0,sourceUpdatedAt:null},t)}))];
 })??[];
 return <fieldset disabled={disabled} className="space-y-2"><legend className="mb-2 text-sm">{t('systemDock.limits.configureHint')}</legend>{[...new Set([...widget.selectedBackends,...form.configurable])].map(backend=>{
  const selected=widget.selectedBackends.includes(backend),index=widget.selectedBackends.indexOf(backend),name=backendLabel(backend),options=windowOptions(backend),current=widget.selectionByBackend[backend],value=current?JSON.stringify([current.poolId,current.windowId]):'',stale=Boolean(current)&&!options.some(option=>option.value===value);
  return <div key={backend} data-official-backend={backend} className="space-y-2 rounded-md border p-3">
   <div className="flex flex-wrap items-center justify-between gap-2"><label className="flex min-h-8 items-center gap-2 text-sm"><input type="checkbox" checked={selected} onChange={event=>toggle(backend,event.target.checked)}/>{name}</label>
    {selected&&<div className="flex gap-1"><SettingsButton variant="ghost" disabled={disabled||index===0} onClick={()=>move(backend,-1)} aria-label={t('systemDock.edit.moveUp',{name})}>↑</SettingsButton><SettingsButton variant="ghost" disabled={disabled||index===widget.selectedBackends.length-1} onClick={()=>move(backend,1)} aria-label={t('systemDock.edit.moveDown',{name})}>↓</SettingsButton></div>}</div>
   {selected&&(options.length>1||stale)&&<div className="grid gap-1 text-xs"><label htmlFor={form.previewId+'-'+backend}>{t('systemDock.limits.windowFor',{agent:name})}</label><select id={form.previewId+'-'+backend} className="min-h-10 max-w-full rounded-md border bg-transparent px-2" value={value} aria-invalid={stale} onChange={event=>pick(backend,event.target.value)}><option value="">{t('systemDock.limits.automatic')}</option>{stale&&<option value={value} disabled>{t('systemDock.limits.windowGone')}</option>}{options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></div>}
  </div>;
 })}</fieldset>;
}
export function OfficialWidgetDialog({form,onClose,onChanged,onReturnFocus}:{form:OfficialWidgetForm;onClose():void;onChanged():void;onReturnFocus():void}){
 const {t}=useAppTranslation(),[name,setName]=useState(form.name),[widget,setWidget]=useState<OfficialWidget>(form.widget),[busy,setBusy]=useState(false),[failure,setFailure]=useState<'invalidName'|'conflict'|'instancePending'|'applyFailed'|null>(null),lock=useRef(false),operation=useRef<SubmitOfficialWidget|null>(null);
 const change=(next:OfficialWidget)=>{setWidget(next);operation.current=null;setFailure(null);};
 const submit=async()=>{
  if(lock.current)return;const parsed=widgetNameSchema.safeParse(name);if(!parsed.success){setFailure('invalidName');return;}lock.current=true;setBusy(true);setFailure(null);
  operation.current??={operationId:crypto.randomUUID(),previewId:form.previewId,name:parsed.data,widget};
  try{const receipt=await window.systemDockSettings!.submitOfficialWidget(operation.current);onChanged();if(receipt.status==='applied')onClose();else setFailure(receipt.status==='conflict'?'conflict':'instancePending');}
  catch(error){setFailure(/CONFLICT|EXPIRED/.test(String(error))?'conflict':'applyFailed');}finally{lock.current=false;setBusy(false);}
 };
 return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent showCloseButton={!busy} className="max-h-[85vh] overflow-y-auto" onEscapeKeyDown={event=>{if(busy)event.preventDefault();}} onCloseAutoFocus={event=>{event.preventDefault();onReturnFocus();}}>
  <DialogTitle>{t('systemDock.widgets.configure')}</DialogTitle><DialogDescription>{t('systemDock.widgets.configurationHint')}</DialogDescription>
  <label className="grid gap-2 text-sm">{t('systemDock.widgets.name')}<input className="min-h-10 rounded-md border bg-transparent px-3" value={name} disabled={busy} aria-invalid={failure==='invalidName'} onChange={event=>{setName(event.target.value);operation.current=null;setFailure(null);}}/></label>
  <OfficialControls form={form} widget={widget} disabled={busy} onChange={change}/>
  {failure&&<SettingsAlert><span role="alert">{t('systemDock.widgets.'+failure)}</span></SettingsAlert>}
  <DialogFooter><SettingsButton variant="outline" disabled={busy} onClick={onClose}>{t('systemDock.widgets.cancel')}</SettingsButton><SettingsButton disabled={busy} aria-busy={busy} onClick={()=>void submit()}>{t(busy?'systemDock.widgets.applying':form.itemId?'systemDock.widgets.applyInstance':'systemDock.widgets.add')}</SettingsButton></DialogFooter>
 </DialogContent></Dialog>;
}
