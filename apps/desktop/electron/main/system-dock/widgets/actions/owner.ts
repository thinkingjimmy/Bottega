/**
 * [INPUT]: Depends on Main-selected action targets and exact visible accepted-scope keys.
 * [OUTPUT]: Provides DockWidgetActions, bounded opaque detail references with expiry, visible-host renewal, target checks and per-action single flight.
 * [POS]: Shared Main action owner for trusted standard details and isolated native sessions; callers supply only an opaque reference.
 */
import {randomBytes} from 'node:crypto';
import type {DockAction} from '@bottega/contracts/plugins/dock/session';

export type WidgetActionTarget=Readonly<{
 key:string;
 kind:DockAction['kind'];
 label:string;
 execute(current:()=>boolean):Promise<void>;
}>;
type Entry={value:DockAction;targetKey:string;expiresAt:number;flight:Promise<void>|null};
type Session={itemId:string;key:string;entries:Map<string,Entry>};
type Ports={current(itemId:string):string|null;targets(itemId:string):readonly WidgetActionTarget[];now?():number;changed?():void;schedule?(callback:()=>void,ms:number):()=>void};
export class DockWidgetActions{
 private readonly sessions=new Map<string,Session>();
 private readonly flights=new Set<Promise<void>>();
 private renewal:(()=>void)|null=null;
 private closed=false;
 constructor(private readonly ports:Ports){}
 private now(){return(this.ports.now??Date.now)();}
 private targets(itemId:string){
  const targets=this.ports.targets(itemId);
  if(targets.length>64||new Set(targets.map(target=>target.key)).size!==targets.length||targets.some(target=>!target.key||!target.label||[...target.label].length>160))throw new Error('DOCK_ACTION_CAPACITY');
  return targets;
 }
 list(owner:string,itemId:string):readonly DockAction[]{
  const key=this.closed?null:this.ports.current(itemId);
  if(!key){this.release(owner);return[];}
  let session=this.sessions.get(owner);
  if(session&&(session.itemId!==itemId||session.key!==key)){this.release(owner);session=undefined;}
  const targets=this.targets(itemId);
  if(!session){if(this.sessions.size>=8)throw new Error('DOCK_ACTION_CAPACITY');session={itemId,key,entries:new Map()};this.sessions.set(owner,session);}
  const now=this.now();
  for(const [ref,entry]of session.entries)if(entry.expiresAt<=now||!targets.some(target=>target.key===entry.targetKey&&target.kind===entry.value.kind&&target.label===entry.value.label))session.entries.delete(ref);
  const actions=targets.map(target=>{
   let entry=[...session!.entries.values()].find(entry=>entry.targetKey===target.key);
   if(!entry){const value:DockAction={ref:randomBytes(16).toString('hex'),kind:target.kind,label:target.label};entry={value,targetKey:target.key,expiresAt:now+60000,flight:null};session!.entries.set(value.ref,entry);}
   entry.expiresAt=now+60000;
   return entry.value;
  });
  this.arm();return actions;
 }
 async invoke(owner:string,itemId:string,ref:string,live:()=>boolean=()=>true):Promise<void>{
  const session=this.sessions.get(owner),entry=session?.entries.get(ref);
  const current=()=>!this.closed&&live()&&this.sessions.get(owner)===session&&session?.itemId===itemId&&this.ports.current(itemId)===session.key&&entry!==undefined&&entry.expiresAt>this.now()&&this.targets(itemId).some(target=>target.key===entry.targetKey&&target.kind===entry.value.kind);
  if(!session||!entry||!current())throw new Error('DOCK_ACTION_UNAVAILABLE');
  if(entry.flight)return entry.flight;
  const target=this.targets(itemId).find(target=>target.key===entry.targetKey&&target.kind===entry.value.kind)!;
  const flight=Promise.resolve().then(()=>{if(!current())throw new Error('DOCK_ACTION_UNAVAILABLE');return target.execute(current);}).finally(()=>{this.flights.delete(flight);if(entry.flight===flight)entry.flight=null;});
  entry.flight=flight;this.flights.add(flight);return flight;
 }
 release(owner:string){this.sessions.delete(owner);this.arm();}
 prune(){for(const [owner,session]of this.sessions)if(this.ports.current(session.itemId)!==session.key)this.release(owner);}
 private arm(){
  const host=this.sessions.get('host'),live=!this.closed&&this.ports.changed&&host&&host.entries.size>0&&this.ports.current(host.itemId)===host.key;
  if(!live){this.renewal?.();this.renewal=null;return;}if(this.renewal)return;
  const notify=()=>{this.renewal=null;this.prune();const current=this.sessions.get('host');if(!this.closed&&current&&current.entries.size>0&&this.ports.current(current.itemId)===current.key)this.ports.changed?.();this.arm();};
  this.renewal=this.ports.schedule?.(notify,30000)??(()=>{const timer=setTimeout(notify,30000);timer.unref?.();return()=>clearTimeout(timer);})();
 }
 health(){return{owners:this.sessions.size,references:[...this.sessions.values()].reduce((count,session)=>count+session.entries.size,0),flights:this.flights.size};}
 close(){this.closed=true;this.renewal?.();this.renewal=null;this.sessions.clear();}
}
