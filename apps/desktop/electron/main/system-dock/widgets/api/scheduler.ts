/**
 * [INPUT]: Depends on finite shared API queue/concurrency defaults and monotonic clocks.
 * [OUTPUT]: Provides an abortable host/origin/owner scheduler with queue-inclusive deadlines.
 * [POS]: Shared API execution admission; previews and installed instances use the same scheduler.
 */
import {performance} from 'node:perf_hooks';
import {DOCK_API_BUDGET as B} from '@bottega/contracts/plugins/dock/api';

type Job={owner:string;origin:string;signal:AbortSignal;deadline:number;run:()=>Promise<unknown>;resolve:(value:unknown)=>void;reject:(error:Error)=>void;release:()=>void};
export class ApiScheduler{
 private readonly queued:Job[]=[];
 private readonly running=new Set<Job>();
 private readonly origins=new Map<string,number>();
 private readonly owners=new Map<string,number>();
 private closed=false;
 schedule<T>(input:{owner:string;origin:string;signal:AbortSignal;deadline:number},run:()=>Promise<T>):Promise<T>{
  if(this.closed||input.signal.aborted)return Promise.reject(new Error('DOCK_API_CANCELLED'));
  if(this.queued.length>=B.queue)return Promise.reject(new Error('DOCK_API_QUEUE_BUDGET'));
  return new Promise<T>((resolve,reject)=>{
   const abort=()=>{const index=this.queued.indexOf(job);if(index>=0){this.queued.splice(index,1);job.release();reject(new Error('DOCK_API_CANCELLED'));this.drain();}};
   const job:Job={...input,run,resolve:resolve as(value:unknown)=>void,reject,release:()=>{if(timer)clearTimeout(timer);input.signal.removeEventListener('abort',abort);}};
   const timer=setTimeout(()=>{const index=this.queued.indexOf(job);if(index>=0){this.queued.splice(index,1);job.release();reject(new Error('DOCK_API_DEADLINE'));this.drain();}},Math.max(1,input.deadline-performance.now()));timer.unref?.();
   input.signal.addEventListener('abort',abort,{once:true});this.queued.push(job);this.drain();
  });
 }
 private drain(){
  if(this.closed)return;
  while(this.running.size<B.apiConcurrentRequests.global){
   const index=this.queued.findIndex(job=>(this.origins.get(job.origin)??0)<B.apiConcurrentRequests.origin&&(this.owners.get(job.owner)??0)<B.apiConcurrentRequests.owner);
   if(index<0)return;const job=this.queued.splice(index,1)[0]!;job.release();
   if(job.signal.aborted||performance.now()>=job.deadline){job.reject(new Error('DOCK_API_DEADLINE'));continue;}
   this.running.add(job);this.origins.set(job.origin,(this.origins.get(job.origin)??0)+1);this.owners.set(job.owner,(this.owners.get(job.owner)??0)+1);
   Promise.resolve().then(job.run).then(job.resolve,error=>job.reject(error instanceof Error?error:new Error('DOCK_API_NETWORK'))).finally(()=>{this.running.delete(job);for(const [map,key]of [[this.origins,job.origin],[this.owners,job.owner]]as const){const count=(map.get(key)??1)-1;if(count)map.set(key,count);else map.delete(key);}this.drain();});
  }
 }
 health(){return{queued:this.queued.length,flights:this.running.size};}
 close(){this.closed=true;for(const job of this.queued.splice(0)){job.release();job.reject(new Error('DOCK_API_CANCELLED'));}}
}
