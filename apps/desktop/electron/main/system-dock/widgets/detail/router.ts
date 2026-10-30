/**
 * [INPUT]: Depends on the fixed private Dock channels and an injected Main IPC transport.
 * [OUTPUT]: Provides createDockDetailRouter, with at most two exact WebContents owners and independent registration cleanup.
 * [POS]: Shared native detail/authoring-preview routing; each host still validates its own frame, nonce, lease and current source.
 */
import type {IpcMain,IpcMainEvent,IpcMainInvokeEvent} from 'electron';
import {DOCK_DETAIL_CHANNEL as CHANNEL} from '../../../../../shared/system-dock/widgets/native';
type Owner={request(event:IpcMainInvokeEvent,nonce:unknown,raw:unknown,gesture:unknown):unknown;
 gesture(event:IpcMainEvent,nonce:unknown,sequence:unknown):void;escape(event:IpcMainEvent,nonce:unknown):void;fault(event:IpcMainEvent,nonce:unknown):void};
export function createDockDetailRouter(ipc:Pick<IpcMain,'handle'|'on'|'removeHandler'|'removeListener'>){
 const owners=new Map<object,Owner>();let installed=false;
 const request=(event:IpcMainInvokeEvent,nonce:unknown,raw:unknown,gesture:unknown)=>{const owner=owners.get(event.sender);return owner?owner.request(event,nonce,raw,gesture):Promise.reject(new Error('DOCK_SESSION_UNAVAILABLE'));};
 const gesture=(event:IpcMainEvent,nonce:unknown,sequence:unknown)=>owners.get(event.sender)?.gesture(event,nonce,sequence);
 const escape=(event:IpcMainEvent,nonce:unknown)=>owners.get(event.sender)?.escape(event,nonce);
 const fault=(event:IpcMainEvent,nonce:unknown)=>owners.get(event.sender)?.fault(event,nonce);
 const listeners=[[CHANNEL.gesture,gesture],[CHANNEL.escape,escape],[CHANNEL.fault,fault]] as const;
 const install=()=>{
  let ownRequest=false;const attached:Array<(typeof listeners)[number]>=[];
  try{ipc.handle(CHANNEL.request,request);ownRequest=true;for(const listener of listeners){ipc.on(listener[0],listener[1]);attached.push(listener);}installed=true;}
  catch(error){if(ownRequest)ipc.removeHandler(CHANNEL.request);for(const listener of attached)ipc.removeListener(listener[0],listener[1]);throw error;}
 };
 return{register(sender:object,owner:Owner){
  if(owners.has(sender)||owners.size>=2)throw new Error('DOCK_NATIVE_OWNER_CAPACITY');if(!installed)install();owners.set(sender,owner);let released=false;
  return()=>{if(released)return;released=true;if(owners.get(sender)===owner)owners.delete(sender);if(!owners.size&&installed){installed=false;ipc.removeHandler(CHANNEL.request);for(const listener of listeners)ipc.removeListener(listener[0],listener[1]);}};
 }};
}
