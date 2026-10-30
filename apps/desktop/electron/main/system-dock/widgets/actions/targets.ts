/**
 * [INPUT]: Depends on accepted Widget declarations, local Base permissions, canonical data owners and guarded Main-window destinations.
 * [OUTPUT]: Provides createWidgetActionTargets with refresh, bound Base, exact Task and independently selected quota/history Usage targets entirely in Main.
 * [POS]: Main action target policy; author code never supplies routes, paths, Chat identities or commands.
 */
import {canonicalJson} from '@bottega/contracts/core/canonical-json';
import type {DockAction} from '@bottega/contracts/plugins/dock/session';
import {agentBackendIdSchema} from '../../../../../shared/platform/agent-schema';
import type {SurfaceMigrationCommand} from '../../../../../shared/ipc/settings/window-surfaces-ipc';
import {USAGE_QUERY_TARGETS} from '../../../../../shared/ipc/settings/usage-ipc';
import type {BasesService} from '../../../bases/bases-service';
import {basePermissionFor} from '../../store/custom/base-access';
import {openDockTask,type DockTasksPort} from '../tasks';
import type {WidgetDetailSource} from '../detail/ports';
import type {WidgetActionTarget} from './owner';
type Ports={
 source(itemId:string):WidgetDetailSource|null;
 bases?:Pick<BasesService,'get'|'store'>;
 tasks?:DockTasksPort;
 refresh(itemId:string):Promise<void>;
 navigate(command:SurfaceMigrationCommand,current:()=>boolean):Promise<void>;
 label(key:string,values?:Record<string,string|number>):string;
};
const requireCurrent=(current:()=>boolean)=>{if(!current())throw new Error('DOCK_ACTION_UNAVAILABLE');};
const label=(value:string)=>[...value.replace(/[\p{Cc}\p{Cf}]/gu,' ')].slice(0,160).join('');
export function createWidgetActionTargets(ports:Ports){
 return(itemId:string):readonly WidgetActionTarget[]=>{
  const source=ports.source(itemId);if(!source)return[];
  const targets:WidgetActionTarget[]=[{key:'refresh',kind:'refresh',label:ports.label('systemDock.panel.refresh'),execute:async current=>{requireCurrent(current);await ports.refresh(itemId);}}];
  const add=(key:string,kind:DockAction['kind'],text:string,execute:WidgetActionTarget['execute'])=>{if(!targets.some(target=>target.key===key))targets.push({key,kind,label:label(text),execute});};
  let baseApproved=false;
  try{baseApproved=basePermissionFor({itemId,scope:source.accepted.scope,widget:source.accepted.widget,dock:source.manifest.dock,prior:source.accepted,consent:false}).baseAccess==='approved';}catch{baseApproved=false;}
  if(baseApproved&&ports.bases)for(const binding of source.accepted.widget.bindings){
   const snapshot=ports.bases.store.peek(binding.ownerKey,binding.ownerInstanceId);if(!snapshot||Object.values(binding.fields).some(id=>!snapshot.meta.columns.some(column=>column.id===id)))continue;
   const [kind,id]=binding.ownerKey.split(':');
   add('base:'+canonicalJson([binding.ownerKey,binding.ownerInstanceId]),'open-base',ports.label('systemDock.widgets.actions.openBase',{name:snapshot.meta.name}),async current=>{
    requireCurrent(current);const owner=await ports.bases!.get(binding.ownerKey);requireCurrent(current);
    if(owner?.meta.ownerInstanceId!==binding.ownerInstanceId)throw new Error('DOCK_ACTION_UNAVAILABLE');
    await ports.navigate({type:'navigate',route:`/bases/${kind}/${encodeURIComponent(id!)}`},current);
   });
  }
  if(source.manifest.dock.data.some(data=>data.kind==='tasks'))for(const task of ports.tasks?.snapshot().tasks.slice(0,50)??[]){
   const reference={chatId:task.chatId,incarnationId:task.incarnationId,requestId:task.requestId,generation:task.generation};
   add('task:'+canonicalJson(reference),'open-task',ports.label('systemDock.widgets.actions.openTask',{name:task.title??ports.label('systemDock.entry.tasks')}),async current=>{requireCurrent(current);await openDockTask(ports.tasks,reference,current);});
  }
  for(const data of source.manifest.dock.data){
   const selected=data.kind==='limits'?source.accepted.widget.settings[data.backendSetting]:data.kind==='activity'?source.accepted.widget.settings[data.sourceSetting]:null;
   if(typeof selected!=='string')continue;const agent=selected==='all'?null:agentBackendIdSchema.safeParse(selected);if(agent!==null&&!agent.success)continue;
   const backend=agent===null?null:agent.data;
   const usageSource=source.manifest.dock.data.some(value=>value.kind==='activity'&&source.accepted.widget.settings[value.sourceSetting]===selected)?USAGE_QUERY_TARGETS.find(value=>value===selected):undefined;
   add('usage:'+(backend??'all'),'open-usage',ports.label('systemDock.widgets.actions.openUsage',{name:backend??ports.label('systemDock.widgets.allAgents')}),async current=>{requireCurrent(current);await ports.navigate({type:'presence-destination',destination:'usage',...(backend?{agent:backend}:{}),...(usageSource?{usageSource}:{})},current);});
  }
  return targets;
 };
}
