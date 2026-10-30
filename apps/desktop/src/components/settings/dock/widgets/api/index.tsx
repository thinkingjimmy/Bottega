/**
 * [INPUT]: Depends on Main-held API form controls, typed non-secret settings, secret-free request reviews and localized host controls.
 * [OUTPUT]: Provides WidgetApiConfiguration with explicit request consent, system-proxy/resolver disclosure, local-only password drafts, test/revoke/clear/copy actions and fail-closed form readiness.
 * [POS]: Context-keyed trusted Main-window connection form; remount resets local secrets and late results are ignored after release.
 */
import {useEffect,useMemo,useRef,useState} from 'react';
import type {DockSettings} from '@bottega/contracts/plugins/dock/settings';
import type {WidgetApiControl,WidgetApiReview} from '../../../../../../shared/system-dock/widgets/api/control';
import {useAppTranslation} from '@/components/providers/preferences/i18n-provider';
import {SettingsAlert,SettingsButton} from '@/components/settings/settings-layout';

type Props={previewId:string;targetId?:string;settings:DockSettings;consent:readonly string[];disabled:boolean;onConsent(value:string[]):void;onReady(value:boolean):void};
const command=(input:WidgetApiControl)=>window.systemDockSettings!.widgetApiControl(input);
export function WidgetApiConfiguration({previewId,targetId,settings,consent,disabled,onConsent,onReady}:Props){
 const {t}=useAppTranslation(),[review,setReview]=useState<WidgetApiReview|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false),[message,setMessage]=useState<'saved'|'tested'|null>(null),[retry,setRetry]=useState(0),[credentials,setCredentials]=useState<Record<string,string>>({}),[copies,setCopies]=useState<Record<string,string>>({});
 const settingsKey=JSON.stringify(settings),alive=useRef(false),lock=useRef(false),context=useMemo(()=>({previewId,...(targetId?{targetId}:{}),settings:JSON.parse(settingsKey)as DockSettings}),[previewId,targetId,settingsKey]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;onReady(false);};},[onReady]);
 useEffect(()=>{let active=true;void command({kind:'review',...context}).then(value=>{if(active&&alive.current)setReview(value);},()=>{if(active&&alive.current)setFailed(true);}).finally(()=>{if(active&&alive.current)setLoading(false);});return()=>{active=false;};},[context,retry]);
 useEffect(()=>{onReady(!loading&&!busy&&!failed&&review!==null&&review.requests.every(request=>(request.authorized||consent.includes(request.id))&&request.configured));},[loading,busy,failed,review,consent,onReady]);
 const run=async(action:()=>Promise<WidgetApiReview>,success:'saved'|'tested'|null=null)=>{
  if(lock.current||disabled||!alive.current)return;lock.current=true;setBusy(true);setFailed(false);setMessage(null);
  try{const value=await action();if(alive.current){setReview(value);setMessage(success);}}
  catch{if(alive.current)setFailed(true);}finally{lock.current=false;if(alive.current)setBusy(false);}
 };
 const save=async()=>{const value=await command({kind:'configure',...context,operationId:crypto.randomUUID(),consent:[...consent],...(Object.values(credentials).some(Boolean)?{credentials:Object.fromEntries(Object.entries(credentials).filter(([,value])=>value.length>0))}:{})});if(alive.current)setCredentials({});return value;};
 const requests=review?.requests??[],slots=requests.filter((request,index)=>request.slot&&requests.findIndex(value=>value.slot===request.slot)===index),blocked=disabled||busy||loading;
 return <section data-widget-api-configuration="" className="grid gap-4" aria-busy={busy||loading}>
  <h3 className="text-sm font-medium">{t('systemDock.widgets.api.title')}</h3>
  <p className="text-xs text-muted-foreground">{t('systemDock.widgets.api.connectionRouting')}</p>
  {loading&&<p role="status" className="text-xs text-muted-foreground">{t('systemDock.widgets.states.loading')}</p>}
  {requests.map(request=><fieldset key={request.id} data-widget-api-request={request.id} disabled={blocked} className="grid gap-3 rounded-md border p-3">
   <legend className="px-1 text-sm font-medium">{request.purpose}</legend>
   <p className="break-all text-xs"><strong>{request.method}</strong> {request.origin}{request.path}</p>
   <div className="text-xs"><p className="mb-1 text-muted-foreground">{t('systemDock.widgets.api.parameters')}</p>{Object.keys(request.parameters).length?<dl className="grid gap-1">{Object.entries(request.parameters).map(([key,value])=><div key={key} className="flex justify-between gap-3"><dt>{key}</dt><dd className="break-all text-right">{String(value)}</dd></div>)}</dl>:<p>{t('systemDock.widgets.api.noParameters')}</p>}</div>
   <label className="flex items-start gap-2 text-sm"><input type="checkbox" data-testid={'widget-api-consent-'+request.id} checked={consent.includes(request.id)||request.authorized} disabled={blocked} onChange={event=>{
    const next=event.target.checked?[...new Set([...consent,request.id])]:consent.filter(id=>id!==request.id);onConsent(next);if(!event.target.checked&&request.authorized)void run(()=>command({kind:'revoke',...context,requestId:request.id}));
   }}/><span>{t('systemDock.widgets.api.consent')}</span></label>
   {request.failure&&<p role="status" className="text-xs text-muted-foreground">{t('systemDock.widgets.api.failures.'+request.failure.code)}{request.failure.status?' '+t('systemDock.widgets.api.httpStatus',{status:request.failure.status}):''}</p>}
   <div className="flex flex-wrap gap-2"><SettingsButton variant="outline" disabled={blocked||!consent.includes(request.id)&&!request.authorized} onClick={()=>void run(async()=>{await save();return command({kind:'test',...context,requestId:request.id});},'tested')}>{t('systemDock.widgets.api.test')}</SettingsButton>
    {request.authorized&&<SettingsButton variant="outline" disabled={blocked} onClick={()=>{onConsent(consent.filter(id=>id!==request.id));void run(()=>command({kind:'revoke',...context,requestId:request.id}));}}>{t('systemDock.widgets.api.revoke')}</SettingsButton>}</div>
  </fieldset>)}
  {slots.map(request=><div key={request.slot!} className="grid gap-2 rounded-md border p-3" data-widget-api-slot={request.slot!}>
   <h4 className="text-sm font-medium">{request.purpose}</h4><p className="break-all text-xs text-muted-foreground">{request.origin} · {request.slot}</p>
   <label className="grid gap-2 text-sm">{t(request.authentication==='bearer'?'systemDock.widgets.api.bearerToken':'systemDock.widgets.api.apiKey')}<input type="password" autoComplete="new-password" spellCheck={false} value={credentials[request.slot!]??''} disabled={blocked} onChange={event=>setCredentials(previous=>({...previous,[request.slot!]:event.target.value}))} className="min-h-10 rounded-md border bg-transparent px-3"/></label>
   <p className="text-xs text-muted-foreground">{t(request.configured?'systemDock.widgets.api.set':'systemDock.widgets.api.unset')}</p>
   <div className="flex flex-wrap gap-2"><SettingsButton variant="outline" disabled={blocked||!consent.includes(request.id)&&!request.authorized} onClick={()=>void run(save,'saved')}>{t('systemDock.widgets.api.save')}</SettingsButton>
    {request.configured&&<SettingsButton variant="outline" disabled={blocked} onClick={()=>void run(async()=>{const value=await command({kind:'clear',...context,slotId:request.slot!});if(alive.current)setCredentials(previous=>({...previous,[request.slot!]:''}));return value;})}>{t('systemDock.widgets.api.clear')}</SettingsButton>}</div>
   {review!.copyChoices.length>0&&<><label className="grid gap-2 text-sm">{t('systemDock.widgets.api.chooseCopy')}<select className="min-h-10 rounded-md border bg-transparent px-3" value={copies[request.slot!]??''} disabled={blocked} onChange={event=>setCopies(previous=>({...previous,[request.slot!]:event.target.value}))}><option value="">{t('systemDock.widgets.api.chooseCopy')}</option>{review!.copyChoices.map(choice=><option key={choice.id} value={choice.id}>{choice.label} · {choice.slotId}</option>)}</select></label><p className="text-xs text-muted-foreground">{t('systemDock.widgets.api.copyHint')}</p><SettingsButton variant="outline" disabled={blocked||!copies[request.slot!]||!consent.includes(request.id)&&!request.authorized} onClick={()=>void run(()=>command({kind:'copy',...context,operationId:crypto.randomUUID(),selectionId:copies[request.slot!]!,slotId:request.slot!}),'saved')}>{t('systemDock.widgets.api.copy')}</SettingsButton></>}
  </div>)}
  {message&&<p role="status" className="text-xs text-muted-foreground">{t('systemDock.widgets.api.'+message)}</p>}
  {failed&&<SettingsAlert>{t(review?'systemDock.widgets.api.failed':'systemDock.widgets.api.loadFailed')}<SettingsButton variant="outline" disabled={busy||disabled} onClick={()=>{setLoading(true);setFailed(false);setReview(null);setMessage(null);setRetry(value=>value+1);}}>{t('systemDock.widgets.api.retry')}</SettingsButton></SettingsAlert>}
 </section>;
}
