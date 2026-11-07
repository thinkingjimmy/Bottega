/**
 * [INPUT]: Cancellable Agent-turn identities and the installed source Project lease owner.
 * [OUTPUT]: Acquires writer custody before spawn and releases it only after verified process cleanup.
 * [POS]: Small bridge seam; keeps plugin engineering out of the Agent execution core.
 */
import type {PluginModeSelection} from '@bottega/contracts/plugins/platform';
export type PluginSourceTurnInput={workspace:string;requestId:string;chatId:string;incarnationId?:string;mode?:PluginModeSelection;signal:AbortSignal};
type Lease={release():Promise<void>};
type Hooks={acquire(input:PluginSourceTurnInput):Promise<Lease|null>};
let installed:Hooks|null=null;
const held=new WeakMap<object,Lease>();
export const setPluginSourceTurnHooks=(hooks:Hooks|null)=>{installed=hooks;};
export const hasPluginSourceTurn=(entry:object)=>held.has(entry);
export async function acquirePluginSourceTurn(entry:object,input:PluginSourceTurnInput){
  if(held.has(entry))return;
  input.signal.throwIfAborted();const lease=await installed?.acquire(input);if(!lease)return;
  if(input.signal.aborted){await lease.release();input.signal.throwIfAborted();}
  held.set(entry,lease);
}
export async function releasePluginSourceTurn(entry:object){
  const lease=held.get(entry);if(!lease)return;await lease.release();held.delete(entry);
}
