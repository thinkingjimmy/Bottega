/**
 * [INPUT]: Depends on confirmed Base plans, bounded immutable page reads, measured Dock budgets and incremental calendar history.
 * [OUTPUT]: Provides validated readonly count/sum/group/record/history refreshes with cumulative budgets, cancellation and exact scope/type checks.
 * [POS]: Main Base Widget computation boundary; it neither grants data access nor exposes full owner snapshots.
 */
import {DOCK_BASE_BUDGET as B,dockDataRequirementSchema,type DockReading,type DockRecord,type DockScalar,type DockGroup,type DockColumn} from '@bottega/contracts/plugins/dock/data';
import {dockBaseBindingSchema,type DockBaseBinding} from '../../../../../shared/system-dock/widgets/instance';
import type {BaseWidgetQuery,DockBasePlan,DockBasePage,DockBasePageReader,DockBaseReadResult} from './model';
import {baseHistory} from './history';
import {calendarDate,zonedCalendar} from './calendar';

function fail(code:string):never{throw new Error(code);}
export function validateDockBasePlan(plan:DockBasePlan){
 if(plan.bindings.length>B.baseBindingCount||plan.queries.length>32||new Set(plan.bindings.map(value=>value.slot)).size!==plan.bindings.length||new Set(plan.queries.map(value=>value.id)).size!==plan.queries.length)fail('DOCK_BASE_PLAN_INVALID');
 if(plan.bindings.reduce((sum,binding)=>sum+Object.keys(binding.fields).length,0)>B.baseFieldCount)fail('DOCK_BASE_FIELD_BUDGET');
 for(const binding of plan.bindings){dockBaseBindingSchema.parse(binding);for(const filter of binding.filter){
  if(filter.op==='on-day')calendarDate(String(filter.value));
  if(['less-than','greater-than'].includes(filter.op)&&typeof filter.value!=='number')fail('DOCK_BASE_FILTER_TYPE_INVALID');
 }}
 for(const raw of plan.queries){
  const query=dockDataRequirementSchema.parse(raw);if(query.kind!=='base')fail('DOCK_BASE_PLAN_INVALID');
  const binding=plan.bindings.find(value=>value.slot===query.binding);if(!binding)fail('DOCK_BASE_BINDING_REQUIRED');
  for(const field of [query.field,query.timeField].filter(Boolean)as string[])if(!Object.hasOwn(binding.fields,field))fail('DOCK_BASE_FIELD_NOT_AUTHORIZED');
  if(['sum','group'].includes(query.operation)&&!query.field)fail('DOCK_BASE_FIELD_REQUIRED');
  if(query.operation==='history')baseHistory(query,plan.settings);
 }
}
export function dockBaseResultBytes(value:unknown){if(Buffer.byteLength(JSON.stringify(value))>B.baseResultBytes)fail('DOCK_BASE_RESULT_BUDGET');}
function scalar(value:unknown):DockScalar{
 if(value===null||value===undefined)return null;
 if(typeof value==='boolean'||typeof value==='string'&&value.length<=500||typeof value==='number'&&Number.isFinite(value))return value as DockScalar;
 return fail('DOCK_BASE_VALUE_UNSUPPORTED');
}
export function validateDockBaseColumns(binding:DockBaseBinding,queries:readonly BaseWidgetQuery[],page:DockBasePage){
 if(page.ownerInstanceId!==binding.ownerInstanceId)fail('DOCK_BASE_OWNER_CHANGED');
 for(const field of Object.values(binding.fields)){
  const column=page.columns.find(value=>value.id===field);if(!column||!['text','number','date','select','checkbox','url'].includes(column.type))fail('DOCK_BASE_FIELD_CHANGED');
 }
 const type=(alias:string)=>page.columns.find(column=>column.id===binding.fields[alias])?.type;
 for(const query of queries){if((query.operation==='sum'||query.operation==='history'&&query.field)&&type(query.field!)!=='number')fail('DOCK_BASE_FIELD_TYPE_CHANGED');if(query.operation==='history'&&type(query.timeField!)!=='date')fail('DOCK_BASE_FIELD_TYPE_CHANGED');}
 for(const filter of binding.filter){if(filter.op==='on-day'&&type(filter.field)!=='date'||['less-than','greater-than'].includes(filter.op)&&type(filter.field)!=='number')fail('DOCK_BASE_FIELD_TYPE_CHANGED');}
}
function predicate(binding:DockBaseBinding){
 const filters=binding.filter.map(filter=>({...filter,calendar:filter.op==='on-day'?zonedCalendar(filter.timeZone!):null}));
 return(row:DockBasePage['rows'][number])=>filters.every(filter=>{
  const value=row.values[binding.fields[filter.field]!];
  if(filter.op==='equals')return(value??null)===filter.value;
  if(filter.op==='not-equals')return(value??null)!==filter.value;
  if(filter.op==='less-than'||filter.op==='greater-than')return typeof value==='number'&&typeof filter.value==='number'&&Number.isFinite(value)&&(filter.op==='less-than'?value<filter.value:value>filter.value);
  if(typeof value!=='string')return false;
  const at=filter.calendar!.timestamp(value);return at!==null&&filter.calendar!.date(at)===filter.value;
 });
}
function reducer(query:BaseWidgetQuery,binding:DockBaseBinding,plan:DockBasePlan,metadata:()=>DockBasePage['columns']){
 let count=0,sum=0,numericCount=0;const records:DockRecord[]=[],groups=new Map<string,DockGroup>();
 const history=query.operation==='history'?baseHistory(query,plan.settings):null;
 return{
  add(row:DockBasePage['rows'][number]){
   count++;
   if(query.operation==='sum'){
    const value=row.values[binding.fields[query.field!]!];if(typeof value==='number'&&Number.isFinite(value)){sum+=value;numericCount++;if(!Number.isFinite(sum))fail('DOCK_BASE_AGGREGATE_INVALID');}
   }else if(query.operation==='group'){
    const key=scalar(row.values[binding.fields[query.field!]!]),signature=JSON.stringify(key),group=groups.get(signature);groups.set(signature,{key,count:(group?.count??0)+1});if(groups.size>B.baseGroupCount)fail('DOCK_BASE_GROUP_BUDGET');
   }else if(query.operation==='records'&&records.length<B.baseDetailRows){
    records.push({id:row.id,values:Object.fromEntries(Object.entries(binding.fields).map(([alias,id])=>[alias,scalar(row.values[id])]))});
   }else if(history)history.add(row.values[binding.fields[query.timeField!]!],query.field?row.values[binding.fields[query.field]!]:undefined);
  },
  result(complete:boolean):DockReading{
   const state=complete?'ready':'partial',updatedAt=Date.now(),values={count:complete?count:null};
   if(query.operation==='sum')return{state:complete?(numericCount?'ready':'no-data'):'partial',updatedAt,values:{...values,sum:complete&&numericCount?sum:null,numericCount:complete?numericCount:null}};
   if(query.operation==='records')return{state:complete&&count<=B.baseDetailRows?'ready':'partial',updatedAt,values,records,columns:Object.entries(binding.fields).map(([id,columnId])=>{const column=metadata().find(value=>value.id===columnId);return{id,label:column?.name??id,type:(column?.type??'text')as DockColumn['type']};})};
   if(query.operation==='group')return{state,updatedAt,values:{...values,groupCount:complete?groups.size:null},groups:complete?[...groups.values()].sort((a,b)=>JSON.stringify(a.key).localeCompare(JSON.stringify(b.key))):[]};
   if(history)return{state,updatedAt,values:{series:history.result(complete)}};
   return{state,updatedAt,values};
  },
 };
}
export async function readDockBases(plan:DockBasePlan,readPage:DockBasePageReader,options:{signal?:AbortSignal;now?:()=>number}={}):Promise<DockBaseReadResult>{
 validateDockBasePlan(plan);
 const now=options.now??(()=>performance.now()),started=now(),deadline=started+B.baseRefreshDeadlineMs,controller=new AbortController(),abort=()=>controller.abort(options.signal?.reason);
 options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
 const live=()=>{controller.signal.throwIfAborted();if(now()>=deadline){controller.abort();fail('DOCK_BASE_REFRESH_DEADLINE');}};
 const readings:Record<string,DockReading>={};let scanned=0,pages=0;
 try{
  for(const binding of plan.bindings){
   const queries=plan.queries.filter(query=>query.binding===binding.slot);if(!queries.length)continue;
   let columns:DockBasePage['columns']=[];const reducers=queries.map(query=>({query,value:reducer(query,binding,plan,()=>columns)})),matches=predicate(binding);
   let offset=0,revision:number|undefined,more=true;
   while(more&&scanned<B.baseRefreshRows){
    live();const limit=Math.min(B.basePageRows,B.baseRefreshRows-scanned);let timer:ReturnType<typeof setTimeout>|undefined,aborted:(()=>void)|undefined;
    const expired=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('DOCK_BASE_REFRESH_DEADLINE'));},Math.max(1,deadline-now()));});
    const cancelled=new Promise<never>((_resolve,reject)=>{aborted=()=>reject(new Error('DOCK_BASE_REFRESH_CANCELLED'));controller.signal.addEventListener('abort',aborted,{once:true});});
    const requested=Promise.resolve().then(()=>{live();return readPage(binding,offset,limit,controller.signal);});
    const page=await Promise.race([requested,expired,cancelled]).finally(()=>{clearTimeout(timer);if(aborted)controller.signal.removeEventListener('abort',aborted);});
    live();if(page.rows.length>limit||page.rows.length===0&&page.hasMore)fail('DOCK_BASE_PAGE_BUDGET');
    if(revision!==undefined&&revision!==page.revision)fail('DOCK_BASE_SNAPSHOT_CHANGED');revision=page.revision;validateDockBaseColumns(binding,queries,page);columns=page.columns;pages++;
    for(const row of page.rows){scanned++;if(matches(row))for(const entry of reducers)entry.value.add(row);}
    offset+=page.rows.length;more=page.hasMore;await new Promise<void>(resolve=>setImmediate(resolve));
   }
   live();for(const entry of reducers)readings[entry.query.id]=entry.value.result(!more);
  }
  live();const result={readings,metrics:{scanned,pages,elapsedMs:now()-started}};dockBaseResultBytes(result);return result;
 }finally{options.signal?.removeEventListener('abort',abort);controller.abort();}
}
