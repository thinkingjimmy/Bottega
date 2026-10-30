/**
 * [INPUT]: Depends on declared internal sources, confirmed instance settings and the existing Usage/Tasks owners.
 * [OUTPUT]: Provides bounded clock, quota, activity and task readings, sixteen shared clock formatter keys and internal demand projections without starting Agents.
 * [POS]: Custom Widget data projection leaf; Base requires its separate confirmed-binding reader and API uses its separate Main-owned broker.
 */
import {createHash} from 'node:crypto';
import type {DockDataRequirement,DockReading} from '@bottega/contracts/plugins/dock/data';
import type {CustomDockWidget} from '../../../../../shared/system-dock/widgets/instance';
import {defaultLimitsWidget,defaultActivityWidget,type DockWidget} from '../../../../../shared/system-dock/layout';
import type {UsageQueryTarget} from '../../../../../shared/ipc/settings/usage-ipc';
import type {DockUsage,LimitsPort,HistoryPort} from '../usage';
import type {DockTasksPort} from '../tasks';
type Ports={usage:DockUsage;limits:LimitsPort|null;history:HistoryPort|null;tasks?:DockTasksPort;now:number;locale:string};
const clockFormatters=new Map<string,{time:Intl.DateTimeFormat;date:Intl.DateTimeFormat}>();
function clockFormatter(source:Extract<DockDataRequirement,{kind:'clock'}>,locale:string){
 const key=JSON.stringify([locale,source.timeZone,source.precision]),cached=clockFormatters.get(key);
 if(cached){clockFormatters.delete(key);clockFormatters.set(key,cached);return cached;}
 const value={time:new Intl.DateTimeFormat(locale,{timeZone:source.timeZone,hour:'2-digit',minute:'2-digit',...(source.precision==='second'?{second:'2-digit' as const}:{})}),date:new Intl.DateTimeFormat(locale,{timeZone:source.timeZone,dateStyle:'medium'})};
 if(clockFormatters.size>=16)clockFormatters.delete(clockFormatters.keys().next().value!);clockFormatters.set(key,value);return value;
}
export function internalWidget(source:DockDataRequirement,widget:CustomDockWidget,ports:Pick<Ports,'limits'|'history'>):Exclude<DockWidget,{type:'custom'}>|null{
 if(source.kind==='limits'){
  const selected=widget.settings[source.backendSetting],agent=ports.limits?.snapshot().agents.find(agent=>agent.backend===selected);return agent?{...defaultLimitsWidget([agent.backend]),selectionByBackend:source.selection?{[agent.backend]:source.selection}:{}}:null;
 }
 if(source.kind==='activity'){
  const selected=widget.settings[source.sourceSetting];return typeof selected==='string'&&(selected==='all'||ports.history?.sources().includes(selected as never))?{...defaultActivityWidget(),source:selected as UsageQueryTarget}:null;
 }
 return null;
}
export const customDemandId=(instanceId:string,sourceId:string)=>'custom-'+createHash('sha256').update(instanceId+'\0'+sourceId).digest('hex').slice(0,32);
export function internalReading(source:DockDataRequirement,widget:CustomDockWidget,ports:Ports):DockReading{
 if(source.kind==='clock'){
  const format=clockFormatter(source,ports.locale);
  const target=source.deadlineSetting?Date.parse(String(widget.settings[source.deadlineSetting])):null;
  if(target!==null&&!Number.isFinite(target))return{state:'needs-setup',updatedAt:null,values:{}};
  const seconds=target===null?null:Math.ceil(Math.max(0,target-ports.now)/1000);
  return{state:'ready',updatedAt:ports.now,values:{time:format.time.format(ports.now),date:format.date.format(ports.now),now:ports.now,
   ...(seconds===null?{}:{remainingSeconds:seconds,remainingHours:Math.ceil(seconds/3600),remainingDays:Math.ceil(seconds/86400)})}};
 }
 if(source.kind==='tasks'){
  const tasks=ports.tasks?.snapshot();return tasks?{state:'ready',updatedAt:ports.now,values:{running:tasks.running,waiting:tasks.waiting,total:tasks.total}}:{state:'no-data',updatedAt:null,values:{}};
 }
 const builtin=internalWidget(source,widget,ports);
 if(source.kind==='limits'&&builtin?.type==='builtin.ai-limits'){
  const face=ports.usage.limitsFace(builtin),reading=face.type==='builtin.ai-limits'?face.sources[0]:null;
  if(!reading)return{state:'needs-setup',updatedAt:null,values:{}};
  const state=reading.state==='ok'?'ready':reading.state==='stale'?'stale':reading.state==='loading'?'loading':reading.state==='needs-auth'?'needs-authorization':reading.state==='unknown'?'no-data':'failed';
  const agent=ports.limits?.snapshot().agents.find(agent=>agent.backend===reading.backend);
  return{state,updatedAt:agent?.receivedAt??null,values:['ready','stale'].includes(state)?{remaining:reading.remaining,maximum:100,resetsAt:reading.resetsAt}:{}};
 }
 if(source.kind==='activity'&&builtin?.type==='builtin.ai-activity'){
  const face=ports.usage.activityFace(builtin),detail=ports.usage.activityDetail('',builtin),state=face.state==='ok'?'ready':face.state==='error'?'failed':face.state;
  return{state,updatedAt:detail.updatedAt,values:['ready','partial'].includes(state)?{tokens:face.tokens,costUsd:face.tokens!==null&&face.tokens>0&&face.unpricedTokens>=face.tokens?null:face.costUsd,unpricedTokens:face.unpricedTokens}:{}};
 }
 return{state:'needs-setup',updatedAt:null,values:{}};
}
