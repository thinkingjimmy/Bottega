/**
 * [INPUT]: Canonical team bridge and React external-store subscription.
 * [OUTPUT]: One revision-fenced team projection shared by Chat panels and Sidebar member rows.
 * [POS]: Renderer team authority adapter; transport states never imply task completion or message processing.
 */
import { useSyncExternalStore } from 'react';
import type { PluginTeamBridge,PluginTeamSnapshot } from '@bottega/contracts/plugins/team';
declare global { interface Window { pluginTeams?:PluginTeamBridge } }
const listeners=new Set<()=>void>();
let state:{teams:readonly PluginTeamSnapshot[];error:string;loading:boolean}={teams:[],error:'',loading:true};
let release:(()=>void)|undefined,generation=0;
const emit=()=>listeners.forEach(listener=>listener());
export const pluginTeamBridge=()=>typeof window==='undefined'?null:window.pluginTeams??null;
function adopt(teams:readonly PluginTeamSnapshot[]){
  const prior=new Map(state.teams.map(team=>[team.id,team]));
  state={teams:teams.map(team=>(prior.get(team.id)?.revision??-1)>team.revision?prior.get(team.id)!:team),error:'',loading:false};emit();
}
export async function refreshPluginTeams(){
  const bridge=pluginTeamBridge();if(!bridge){if(state.loading){state={...state,loading:false};emit();}return;}
  const request=++generation;
  try{const teams=await bridge.list({});if(request===generation)adopt(teams);}
  catch(cause){if(request===generation){state={...state,error:cause instanceof Error?cause.message:String(cause),loading:false};emit();}}
}
function subscribe(listener:()=>void){
  listeners.add(listener);
  if(listeners.size===1){const bridge=pluginTeamBridge();release=bridge?.onChanged(()=>void refreshPluginTeams());void refreshPluginTeams();}
  return()=>{listeners.delete(listener);if(!listeners.size){release?.();release=undefined;generation++;}};
}
export const usePluginTeams=()=>useSyncExternalStore(subscribe,()=>state);
