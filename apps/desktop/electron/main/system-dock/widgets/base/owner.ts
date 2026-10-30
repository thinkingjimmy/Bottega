/**
 * [INPUT]: Depends on canonical Base service reads, immutable current snapshots and per-call local permission/context guards.
 * [OUTPUT]: Provides a bounded selected-field page reader with exact owner/revision checks before and after owner resolution.
 * [POS]: Main-only Base Widget bridge; it never clones a full Base, creates an owner or reads an unselected field.
 */
import {canonicalJson} from '@bottega/contracts/core/canonical-json';
import {DOCK_BASE_BUDGET as B} from '@bottega/contracts/plugins/dock/data';
import type {DockBaseBinding} from '../../../../../shared/system-dock/widgets/instance';
import type {BaseSnapshot} from '../../../../../shared/bases/model/bases-ipc';
import type {DockBasePageReader} from './model';
type OwnerPort={get(ownerKey:string):Promise<BaseSnapshot|null>;peek(ownerKey:string):Readonly<{meta:Readonly<{ownerInstanceId:string;revision:number}>}>|null|undefined};
const FIELD_TYPES=new Set(['text','number','date','select','checkbox','url']);
export function createDockBaseReader(owner:OwnerPort,authorized:(binding:DockBaseBinding)=>boolean,current:()=>boolean):DockBasePageReader{
 const snapshots=new Map<string,BaseSnapshot>();
 return async(binding,offset,limit,signal)=>{
  const live=()=>{signal.throwIfAborted();if(!current()||!authorized(binding))throw new Error('DOCK_BASE_AUTHORIZATION_REQUIRED');};
  live();if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>B.basePageRows||offset+limit>B.baseRefreshRows)throw new Error('DOCK_BASE_PAGE_BUDGET');
  if(Object.keys(binding.fields).length>B.baseFieldCount)throw new Error('DOCK_BASE_FIELD_BUDGET');
  const key=canonicalJson(binding);let snapshot=snapshots.get(key);
  if(!snapshot){
   const resolved=await owner.get(binding.ownerKey);live();
   if(!resolved||resolved.meta.ownerInstanceId!==binding.ownerInstanceId)throw new Error('DOCK_BASE_OWNER_CHANGED');
   snapshot=resolved;snapshots.set(key,resolved);
  }
  const present=owner.peek(binding.ownerKey);live();
  if(!present||present.meta.ownerInstanceId!==binding.ownerInstanceId||present.meta.revision!==snapshot.meta.revision)throw new Error('DOCK_BASE_SNAPSHOT_CHANGED');
  const ids=[...new Set(Object.values(binding.fields))],columns=ids.map(id=>{
   const column=snapshot!.meta.columns.find(value=>value.id===id);
   if(!column||!FIELD_TYPES.has(column.type))throw new Error('DOCK_BASE_FIELD_CHANGED');
   return{id:column.id,name:column.name,type:column.type};
  });
  const rows=snapshot.rows.slice(offset,offset+limit).map(row=>({id:row.id,values:Object.fromEntries(ids.map(id=>[id,row.values[id]??null]))}));
  live();return{revision:snapshot.meta.revision,ownerInstanceId:snapshot.meta.ownerInstanceId,columns,rows,hasMore:offset+rows.length<snapshot.rows.length};
 };
}
