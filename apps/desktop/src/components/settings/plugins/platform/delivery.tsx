/**
 * [INPUT]: Reviewed immutable package delivery, original-operation progress and canonical accepted/active catalog revisions and the real account-change store.
 * [OUTPUT]: Explicit receiver acceptance, truthful progress/cancellation and current-account Share consent/status without accepting on another computer.
 * [POS]: Unified Plugins detail delivery controls; review never switches code and progress survives detail remounts by operation identity.
 */
import { useEffect,useRef,useState } from 'react';
import type { PluginUpdateProgress,PluginUpdateReview,UnifiedPluginCatalogItem } from '@bottega/contracts/plugins/platform';
import { AppDialogBody,AppDialogContent } from '@ai-chat/ui/components/ui/app-dialog';
import { Dialog,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from '@ai-chat/ui/components/ui/dialog';
import { SettingsAlert,SettingsButton } from '@/components/settings/settings-layout';
import { pluginPlatformBridge } from '@/lib/plugin-platform/client';
import { pluginPlatformCopy } from '@/lib/plugin-platform/copy';
import { useCloudAccount } from '@/lib/cloud/client';
import { pluginDeliveryCopy } from '@/lib/plugin-platform/delivery-copy';
const terminal=(value:PluginUpdateProgress|null)=>!!value&&['ready','failed','cancelled'].includes(value.state);
const operationKey=(id:string)=>`bottega.plugin.update.${id}`;
const previousOperation=(id:string)=>{try{const value=sessionStorage.getItem(operationKey(id));return value&&/^[\w.-]{1,160}$/.test(value)?value:null;}catch{return null;}};
const retainOperation=(id:string,value:string|null)=>{try{if(value)sessionStorage.setItem(operationKey(id),value);else sessionStorage.removeItem(operationKey(id));}catch{/* The current view still retains the original operation. */}};
type DeliveryProps={plugin:UnifiedPluginCatalogItem;locale:string};
export function UnifiedPluginDelivery(props:DeliveryProps){
  const account=useCloudAccount(),accountKey=account.profile?.userId??'signed-out';
  return <PluginDelivery key={`${props.plugin.manifest.id}/${accountKey}`} {...props} accountKey={accountKey}/>;
}
function PluginDelivery({plugin,locale,accountKey}:DeliveryProps&{accountKey:string}){
  const bridge=pluginPlatformBridge(),copy=pluginPlatformCopy(locale),delivery=pluginDeliveryCopy(locale),id=plugin.manifest.id,operationScope=`${id}/${accountKey}`;
  const [review,setReview]=useState<PluginUpdateReview|null>(null),[operation,setOperation]=useState(()=>previousOperation(operationScope)),[progress,setProgress]=useState<PluginUpdateProgress|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[missing,setMissing]=useState(false),[published,setPublished]=useState<{reference:string;revisionId:string}|null>(null),[shareReview,setShareReview]=useState(false),[sharing,setSharing]=useState<{enabled:boolean;lastPublishedRevision?:string}|null>(null);
  const lock=useRef(false),accepting=useRef(false),live=useRef(true);
  useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  useEffect(()=>{if(!bridge||plugin.manifest.source.format!=='bottega')return;let active=true,request=0;const load=()=>{const expected=++request;void bridge.sharingStatus({pluginId:id}).then(value=>{if(active&&expected===request)setSharing(value);},()=>{if(active&&expected===request)setSharing(null);});};load();const stop=bridge.onChanged(load);window.addEventListener('focus',load);return()=>{active=false;stop();window.removeEventListener('focus',load);};},[bridge,id,plugin.manifest.source.format]);
  const adopt=(next:PluginUpdateProgress)=>{if(!live.current)return;setProgress(current=>current?.operationId===next.operationId&&terminal(current)&&!terminal(next)?current:next);};
  useEffect(()=>{
    if(!bridge||!operation)return;let active=true,misses=0,timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{try{const next=await bridge.updateProgress({operationId:operation});if(!active)return;
      if(next){if(next.pluginId!==id||next.operationId!==operation)throw new Error(copy.unavailable);misses=0;setMissing(false);setProgress(current=>terminal(current)&&!terminal(next)?current:next);if(terminal(next))return;}
      else if(++misses>=10){setMissing(true);setError(delivery.progressUnknown);return;}
      timer=setTimeout(()=>void poll(),500);
    }catch(cause){if(active){setError(cause instanceof Error?cause.message:String(cause));timer=setTimeout(()=>void poll(),2000);}}};
    void poll();return()=>{active=false;clearTimeout(timer);};
  },[bridge,operation,id,copy.unavailable,delivery.progressUnknown]);
  const running=!!operation&&!terminal(progress)&&!missing;
  const run=async(action:()=>Promise<unknown>)=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await action();}catch(cause){if(live.current)setError(cause instanceof Error?cause.message:String(cause));}finally{lock.current=false;if(live.current)setBusy(false);}};
  const dismiss=()=>void run(async()=>{if(review)await bridge!.dismissUpdate({reviewId:review.reviewId});if(live.current)setReview(null);});
  const accept=()=>{if(!review||!bridge||accepting.current||lock.current)return;accepting.current=true;const operationId=crypto.randomUUID();retainOperation(operationScope,operationId);setOperation(operationId);setProgress(null);setMissing(false);setError('');setReview(null);
    void bridge.acceptUpdate({reviewId:review.reviewId,operationId,trust:true}).then(adopt,cause=>{if(live.current)setError(cause instanceof Error?cause.message:String(cause));}).finally(()=>{accepting.current=false;});};
  const available=plugin.installation.origin==='external'&&plugin.availableRevision&&plugin.availableRevision!==plugin.acceptedRevision;
  if(plugin.manifest.source.format!=='bottega')return null;
  return <div className="space-y-3" data-plugin-delivery="">
    <div className="flex flex-wrap gap-2">{available&&<SettingsButton variant="outline" data-plugin-review-update="" disabled={!bridge||busy||running} onClick={()=>void run(async()=>{const value=await bridge!.reviewUpdate({pluginId:id});if(live.current)setReview(value);})}>{delivery.review}</SettingsButton>}
      {plugin.activeRevision&&<SettingsButton variant="ghost" disabled={!bridge||busy||running} onClick={()=>setShareReview(true)}>{delivery.send}</SettingsButton>}
    </div>
    {error&&<SettingsAlert>{error}</SettingsAlert>}
    {operation&&<div className="space-y-2 rounded-md border p-3 text-xs" data-plugin-update-progress={operation} data-plugin-update-state={missing?'unavailable':progress?.state??'reviewed'} aria-live="polite"><p className="font-medium">{missing?copy.unavailable:progress?delivery[progress.state]:delivery.preparing}</p>
      {progress?.bytes!==undefined&&<p className="text-muted-foreground">{new Intl.NumberFormat(locale).format(progress.bytes)}{progress.totalBytes!==undefined?` / ${new Intl.NumberFormat(locale).format(progress.totalBytes)}`:''} {delivery.bytes}</p>}
      {progress?.error&&<p className="break-words text-destructive">{progress.error}</p>}
      {running&&<SettingsButton variant="ghost" disabled={busy} onClick={()=>void run(async()=>adopt(await bridge!.cancelUpdate({operationId:operation})))}>{delivery.cancelTransfer}</SettingsButton>}
      {(missing||terminal(progress))&&<SettingsButton variant="ghost" disabled={busy} onClick={()=>{retainOperation(operationScope,null);setOperation(null);setProgress(null);setMissing(false);setError('');}}>{copy.close}</SettingsButton>}
    </div>}
    {sharing?.enabled&&<SettingsAlert tone="warn" data-plugin-sharing-enabled=""><p>{delivery.published}</p>{published&&<p className="mt-2 break-all text-xs">{delivery.reference}: {published.reference}</p>}</SettingsAlert>}
    <Dialog open={!!review} onOpenChange={open=>{if(!open&&!busy)dismiss();}}><AppDialogContent data-plugin-update-review="" aria-busy={busy}><DialogHeader><DialogTitle>{review?.name}</DialogTitle><DialogDescription>{delivery.reviewNote}</DialogDescription></DialogHeader><AppDialogBody className="space-y-4">
      {review&&<><dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 break-all text-xs"><dt className="text-muted-foreground">{delivery.revision}</dt><dd>{review.revisionId}</dd><dt className="text-muted-foreground">{delivery.sourceComputer}</dt><dd>{review.sourceInstallationId}</dd><dt className="text-muted-foreground">{delivery.packageSize}</dt><dd>{new Intl.NumberFormat(locale).format(review.bytes)} {delivery.bytes}</dd></dl>
        <ul className="space-y-1 text-sm">{review.contributions.map(item=><li key={`${item.kind}/${item.id}`}>{item.name}<span className="ml-2 text-xs text-muted-foreground">{copy[item.kind==='mode'?'modeKind':item.kind as keyof typeof copy]??item.kind}</span></li>)}</ul>
        {review.trustRequired&&<SettingsAlert tone="warn">{copy.trustBody}</SettingsAlert>}
      </>}{error&&<SettingsAlert>{error}</SettingsAlert>}
    </AppDialogBody><DialogFooter><SettingsButton variant="ghost" data-plugin-update-dismiss="" disabled={busy} onClick={dismiss}>{copy.cancel}</SettingsButton><SettingsButton data-plugin-update-accept="" disabled={busy||!review} onClick={accept}>{review?.trustRequired?delivery.trustApply:delivery.apply}</SettingsButton></DialogFooter></AppDialogContent></Dialog>
    <Dialog open={shareReview} onOpenChange={open=>{if(!busy)setShareReview(open);}}><AppDialogContent data-plugin-share-review="" aria-busy={busy}><DialogHeader><DialogTitle>{delivery.shareTitle}</DialogTitle><DialogDescription>{plugin.manifest.name}</DialogDescription></DialogHeader><AppDialogBody><p className="text-sm leading-relaxed text-muted-foreground">{delivery.shareBody}</p>{error&&<SettingsAlert>{error}</SettingsAlert>}</AppDialogBody><DialogFooter><SettingsButton variant="ghost" disabled={busy} onClick={()=>setShareReview(false)}>{copy.cancel}</SettingsButton><SettingsButton disabled={busy||!bridge} onClick={()=>void run(async()=>{const value=await bridge!.publishPlugin({pluginId:id}),status=await bridge!.sharingStatus({pluginId:id});if(live.current){setPublished(value);setSharing(status);setShareReview(false);}})}>{delivery.shareAction}</SettingsButton></DialogFooter></AppDialogContent></Dialog>
  </div>;
}
