/**
 * [INPUT]: Verified bundled Node, the shared Seatbelt launch policy and compiler process-tree supervision.
 * [OUTPUT]: Runs bounded plugin installation and compilation without inherited host credentials.
 * [POS]: Engineering process owner; online installation and offline builds use separate launches.
 */
import {mkdir,mkdtemp,rm,realpath,writeFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fencePackageLaunch} from '../../host/package/launch';
import {supervise} from '../../apps/gui-build/pipeline/process/supervision';
import type {PluginCommand,PluginCommandResult} from './dependencies';

export function pluginEngineeringRunner(input:{identity:string;privateRoot:string;readRoots:readonly string[];writeRoots:readonly string[];pnpm?:string}){
  return async(command:PluginCommand):Promise<PluginCommandResult>=>{
    command.signal?.throwIfAborted();
    const home=await realpath(await mkdtemp(join(tmpdir(),'bottega-plugin-engineering-home-')));
    await mkdir(input.privateRoot,{recursive:true,mode:0o700});
    try{
    const bin=join(home,'bin');
    if(input.pnpm){
      const quote=(value:string)=>`'${value.replaceAll("'","'\\''")}'`;
      await mkdir(bin,{mode:0o700});
      await writeFile(join(bin,'pnpm'),`#!/bin/sh\nexec ${quote(command.command)} ${quote(input.pnpm)} "$@"\n`,{mode:0o700});
    }
    const launch=fencePackageLaunch({command:command.command,args:[...command.args],cwd:command.cwd,
      env:{HOME:home,PATH:`${input.pnpm?bin+':':''}${dirname(command.command)}:/usr/bin:/bin`,LANG:'en_US.UTF-8',CI:'true',NO_COLOR:'1',
        XDG_CACHE_HOME:join(input.privateRoot,'cache'),XDG_CONFIG_HOME:join(input.privateRoot,'config'),XDG_DATA_HOME:join(input.privateRoot,'data'),XDG_STATE_HOME:join(input.privateRoot,'state'),PNPM_HOME:join(input.privateRoot,'pnpm')}},{
      identity:input.identity,workspace:command.cwd,network:command.network,
      readRoots:[...input.readRoots,...(input.pnpm?[dirname(dirname(input.pnpm))]:[]),command.cwd,home],writeRoots:[...input.writeRoots],
    });
    const env=Object.fromEntries(Object.entries(launch.env??{}).filter((value):value is [string,string]=>value[1]!==undefined));
    const result=await supervise({...launch,env,stdin:Buffer.alloc(0)},command.signal,command.network?180_000:60_000,
      {rssBytes:1024*1024*1024,cpuTimeMs:120_000,processCount:24});
    if(result.limit)throw new Error(`PLUGIN_PROCESS_${result.limit.toUpperCase()}: ${result.stderr.slice(-2048)}`);
    return result;
    }finally{await rm(home,{recursive:true,force:true});}
  };
}
