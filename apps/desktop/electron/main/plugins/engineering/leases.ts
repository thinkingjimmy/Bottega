/**
 * [INPUT]: Durable canonical WorkspaceLeases and operation owners supplied by turn custody.
 * [OUTPUT]: FIFO cancellable source leases with reentrant execution-group membership and delayed release.
 * [POS]: Plugin-source writer admission; ordinary Project execution does not acquire these leases.
 */
import {join} from 'node:path';
import {WorkspaceLeases,canonicalWorkspace} from '../../projects/git/leases/workspace-leases';
export type AuthoringOwner={kind:'turn';id:string};
export type AuthoringLease={owner:AuthoringOwner;workspace:string;release():Promise<void>};
type Waiter={owner:AuthoringOwner;participant:string;signal?:AbortSignal;resolve(value:AuthoringLease):void;reject(error:unknown):void;abort?:()=>void};
type Holder={owner:string;participants:Set<symbol>};

export class PluginAuthoringLeases{
  private readonly durable:WorkspaceLeases;
  private readonly holders=new Map<string,Holder>();
  private readonly waiters=new Map<string,Waiter[]>();
  private readonly listeners=new Set<()=>void>();
  private tail:Promise<unknown>=Promise.resolve();
  private closed=false;
  constructor(userData:string){this.durable=new WorkspaceLeases(join(userData,'plugin-authoring'));}
  async initialize(){
    await this.durable.initialize();
    // Startup custody settles prior child processes before this owner opens admission.
    for(const lease of this.durable.list())await this.durable.releaseRun(lease.runId);
  }
  private ownerKey(owner:AuthoringOwner){if(!/^[A-Za-z0-9_.:-]{1,110}$/.test(owner.id))throw new Error('PLUGIN_LEASE_OWNER_INVALID');return`${owner.kind}:${owner.id}`;}
  onChanged(listener:()=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
  private changed(){for(const listener of this.listeners)listener();}
  acquire(workspace:string,owner:AuthoringOwner,participant:string,signal?:AbortSignal):Promise<AuthoringLease>{
    if(this.closed)return Promise.reject(new Error('PLUGIN_LEASES_CLOSED'));signal?.throwIfAborted();
    const key=canonicalWorkspace(workspace),ownerId=this.ownerKey(owner);
    return new Promise((resolve,reject)=>{
      const waiter:Waiter={owner,participant,signal,resolve,reject};
      waiter.abort=()=>{const queue=this.waiters.get(key);if(queue)this.waiters.set(key,queue.filter(value=>value!==waiter));this.changed();reject(signal?.reason??new Error('PLUGIN_AUTHORING_CANCELLED'));};
      signal?.addEventListener('abort',waiter.abort,{once:true});
      this.enqueue(async()=>{
        if(signal?.aborted){waiter.abort?.();return;}
        const holder=this.holders.get(key);
        if(!holder||holder.owner===ownerId)await this.grant(key,waiter);
        else{const queue=this.waiters.get(key)??[];queue.push(waiter);this.waiters.set(key,queue);this.changed();}
      }).catch(reject);
    });
  }
  waiting(workspace:string){return(this.waiters.get(canonicalWorkspace(workspace))??[]).map(value=>({owner:value.owner,participant:value.participant}));}
  private async grant(key:string,waiter:Waiter){
    const owner=this.ownerKey(waiter.owner);
    const acquired=await this.durable.acquire(key,owner,waiter.participant,Date.now());
    if(acquired!==true)throw new Error('PLUGIN_LEASE_CUSTODY_CONFLICT');
    if(this.closed||waiter.signal?.aborted){await this.durable.release(key,owner);waiter.reject(waiter.signal?.reason??new Error('PLUGIN_LEASES_CLOSED'));return;}
    const holder=this.holders.get(key)??{owner,participants:new Set<symbol>()};
    const token=Symbol(waiter.participant);holder.participants.add(token);this.holders.set(key,holder);
    waiter.signal?.removeEventListener('abort',waiter.abort!);
    this.changed();
    let released=false;
    waiter.resolve({owner:waiter.owner,workspace:key,release:()=>{
      if(released)return Promise.resolve();released=true;
      return this.enqueue(async()=>{
        holder.participants.delete(token);if(holder.participants.size)return;
        await this.durable.release(key,owner);this.holders.delete(key);
        const queue=this.waiters.get(key)??[];
        let next=queue.shift();while(next?.signal?.aborted){next.reject(next.signal.reason);next=queue.shift();}
        this.waiters.set(key,queue);
        this.changed();
        if(next)await this.grant(key,next);
      });
    }});
  }
  private enqueue<T>(work:()=>Promise<T>){const result=this.tail.then(work);this.tail=result.catch(()=>{});return result;}
  async close(){
    this.closed=true;
    for(const queue of this.waiters.values())for(const waiter of queue){waiter.signal?.removeEventListener('abort',waiter.abort!);waiter.reject(new Error('PLUGIN_LEASES_CLOSED'));}
    this.waiters.clear();await this.tail;
    for(const [key,holder]of this.holders)await this.durable.release(key,holder.owner);
    this.holders.clear();await this.durable.closeAndFlush();
  }
}
