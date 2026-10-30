/**
 * [INPUT]: Depends on a temporary accepted draft, verified packet, shared data/Base/API/native owners and current visibility.
 * [OUTPUT]: Provides createWidgetPreviewRuntime with isolated demand namespaces, shared rendering, demonstration actions and full cleanup.
 * [POS]: Independent preview composition; accepted Dock instances keep their own data, grants, native owner and Usage demand.
 */
import {widgetApiDraftId,widgetApiDraftOwner} from '../custom/api';
import type {DockApiData} from '../api/owner';
import type {DockApiConsumer,ApiOwner} from '../api/model';
import {randomBytes} from 'node:crypto';
import type {DockAction} from '@bottega/contracts/plugins/dock/session';
import {sampleReadings} from '../../../../../shared/system-dock/widgets/preview/sample';
import {DockCustomWidgets} from '../custom/runtime';
import {createDockBaseData} from '../base/lazy';
import {createDockWidgetDetail} from '../detail/lazy';
import type {DockWidgetDetailPort} from '../detail/ports';
import type {DockBaseDataPort} from '../base/model';
import type {WidgetPreviewRuntime,WidgetPreviewSession} from './ports';
import type {SystemDockRuntimePorts} from '../../composition';
import type {PluginSurfaceGateway} from '../../../plugins/surface-runtime/gateway';
import type {LocalWidgetScope} from '../../store/custom/model';
type Ports={runtime:SystemDockRuntimePorts;api?:DockApiData;gateway:PluginSurfaceGateway;scope():LocalWidgetScope;masked():boolean;
 account(backend:string):string|null;onAccounts(listener:()=>void):()=>void;label(key:string):string;
 demonstrate(ref:string):Promise<void>;finish():void};
export async function createWidgetPreviewRuntime(session:WidgetPreviewSession,current:()=>boolean,changed:()=>void,ports:Ports):Promise<WidgetPreviewRuntime>{
 const {runtime:inputs}=ports,{item,accepted,prepared}=session;let data:DockCustomWidgets|null=null,base:DockBaseDataPort|null=null,native:DockWidgetDetailPort|null=null,api:DockApiConsumer|null=null,apiOwner:ApiOwner|null=null,closed=false;
 const actions:DockAction[]=[{ref:randomBytes(16).toString('hex'),kind:'refresh',label:ports.label('systemDock.panel.refresh')}];
 for(const kind of ['base','tasks','activity','limits']as const)if(prepared.manifest.dock.data.some(source=>source.kind===kind)){const action=kind==='base'?'open-base':kind==='tasks'?'open-task':'open-usage';if(!actions.some(value=>value.kind===action))actions.push({ref:randomBytes(16).toString('hex'),kind:action,label:ports.label(kind==='base'?'systemDock.widgets.sources.base':kind==='tasks'?'systemDock.entry.tasks':'systemDock.widgets.sources.activity')});}
 const notify=()=>{if(!closed){data?.reconcile();native?.reconcile();changed();}};
 const close=async()=>{if(closed)return;closed=true;const errors:unknown[]=[];for(const run of [()=>native?.close(),()=>data?.close(),()=>base?.close(),()=>api?.close(),()=>apiOwner?ports.api?.revoke(apiOwner):undefined])try{await run();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'DOCK_PREVIEW_RUNTIME_CLEANUP_FAILED');};
 const packages={read:async(reference:string)=>{if(closed||!current()||reference!==prepared.preview.packageRef)throw new Error('DOCK_PREVIEW_SCOPE_CHANGED');return structuredClone(prepared.packet);}};
 try{
  if(session.mode==='real'&&ports.api&&prepared.manifest.dock.data.some(source=>source.kind==='api')){
   const source={item,accepted,manifest:prepared.manifest,dataIdentity:''};
   apiOwner=widgetApiDraftOwner(prepared.scope,prepared.preview.id,widgetApiDraftId(prepared.scope,prepared.preview.id,prepared.chatId,session.apiTargetId));
   const credentialOwner=session.apiTargetId?{...apiOwner,ownerKind:'instance' as const,ownerId:session.apiTargetId}:apiOwner;
   await ports.api.configure(source,{operationId:'preview-'+session.id,consent:[...new Set([...session.apiConsent,...ports.api.rebindable(source,credentialOwner)])]},apiOwner,credentialOwner);
   api=ports.api.createConsumer({source:id=>id===item.id&&!closed?source:null,owner:()=>apiOwner!,credentialOwner:()=>credentialOwner,current:()=>!closed&&current(),changed:notify});
  }
  if(session.mode==='real'&&inputs.bases)base=createDockBaseData({bases:inputs.bases,source:id=>current()?data?.source(id)??null:null,changed:notify});
  native=createDockWidgetDetail({contextKind:'authoring-preview',mainDirectory:inputs.mainDirectory,gateway:ports.gateway,packages,source:id=>current()?data?.source(id)??null:null,read:(id,sources)=>data!.read(id,sources),
   actions:()=>actions,invokeAction:async(_owner,_id,ref,live)=>{if(!live())throw new Error('DOCK_PREVIEW_SCOPE_CHANGED');await ports.demonstrate(ref);},releaseActions:()=>{},locale:inputs.locale,theme:()=>session.theme,changed:notify,closePanel:ports.finish,focusPanel:()=>session.window.focus(),label:ports.label});
  data=new DockCustomWidgets({scope:ports.scope,locale:inputs.locale,masked:ports.masked,item:id=>id===item.id&&current()?item:null,accepted:target=>target.id===item.id&&current()?accepted:null,packages,
   usageScope:'authoring-preview',...(session.mode==='sample'?{sampleReadings}:{}),limits:session.mode==='real'?inputs.limits:null,history:session.mode==='real'?inputs.history:null,tasks:session.mode==='real'?inputs.tasks:undefined,base:base??undefined,api:api??undefined,
   account:ports.account,onAccounts:ports.onAccounts,presentation:source=>native!.presentation(source),actions:()=>actions,changed:notify});
  if(session.mode==='real')await data.validate(prepared.manifest.dock,item.widget);
  return{setVisible(visible){if(closed)return;data!.setVisible('dock-panel',visible?[{itemId:item.id,widget:item.widget}]:[]);native!.presented(visible?session.window:null,visible?item.id:null);},
   snapshot(){const value=data!.detail(item,'bottom');if(!value)throw new Error('DOCK_PREVIEW_DATA_UNAVAILABLE');return{...value,actions};},bounds(slot){if(slot){native!.presented(session.window,item.id);native!.bounds(slot);}else native!.presented(null,null);},retry(key){native!.presented(session.window,item.id);native!.retry(item.id,key);notify();},refresh:()=>data!.refresh(item.id),health:()=>({...native!.health(),base:base?.health()??{consumers:0,flights:0,timers:0},...(api?{api:api.health()}:{} )}),close};
 }catch(error){try{await close();}catch(cleanup){throw new AggregateError([error,cleanup],'DOCK_PREVIEW_RUNTIME_INITIALIZATION_FAILED');}throw error;}
}
