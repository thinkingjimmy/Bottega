/**
 * [INPUT]: Live plugin/source bindings, verified runtime paths, managed runner, source controls and explicit script approval.
 * [OUTPUT]: Serializes/cancels dependency installs and caches only an exact still-current published-input receipt.
 * [POS]: Lazy operation owner; startup keeps only its typed deferred port and never loads prompts or install logic.
 */
import { mkdir, lstat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { runtimePort } from '../../../runtime';
import { PluginSourceSupersededError } from '../../platform/model';
import { assertPluginSourceRoot } from '../../process/source-root';
import { installPluginDependencies, type PluginCommand, type PluginCommandResult } from '../dependencies';
import { pluginEngineeringRunner } from '../execution';
import { admitDependencySource, dependencyFingerprint, dependencyStateFingerprint, dependencyLocalSourceDigest, type DependencyReceipt } from './model';
import { inventoryPluginTree } from '../snapshot';

type Runtime={node:string;pnpm:string;run(command:PluginCommand):Promise<PluginCommandResult>};
type Ports={userData:string;signal?:AbortSignal;name(id:string):string;current(id:string,source:string):void;
  warnings(id:string,warnings:string[]):Promise<void>;
  runtime?(input:{id:string;privateRoot:string;storeDir:string}):Runtime};
type Result=Pick<DependencyReceipt,'ignoredBuilds'|'dependencyFingerprint'|'localSourceDigest'>;
export class PluginDependencyInstaller{
  private readonly stop=new AbortController();
  private readonly pending=new Map<string,Promise<Result>>();
  private readonly installed=new Map<string,{fingerprint:string;localSourceDigest?:string;dev:number;ino:number}>();
  constructor(private readonly ports:Ports){}
  install(id:string,source:string,signal?:AbortSignal):Promise<Result>{
    const previous=this.pending.get(source)??Promise.resolve(),combined=AbortSignal.any([this.stop.signal,...(this.ports.signal?[this.ports.signal]:[]),...(signal?[signal]:[])]);
    const work=previous.catch(()=>{}).then(()=>this.perform(id,source,combined));this.pending.set(source,work);
    void work.finally(()=>{if(this.pending.get(source)===work)this.pending.delete(source);}).catch(()=>{});return work;
  }
  invalidate(id:string,source:string){this.installed.delete(`${id}/${source}`);}
  private async perform(id:string,source:string,signal:AbortSignal):Promise<Result>{
    signal.throwIfAborted();this.ports.current(id,source);await assertPluginSourceRoot(source);
    const admitted=admitDependencySource(source),digest=dependencyStateFingerprint(admitted.files),key=`${id}/${source}`;
    const pkg=admitted.files['package.json']?JSON.parse(admitted.files['package.json'].bytes.toString('utf8')):null;
    if(!pkg&&admitted.modules)throw new Error('PLUGIN_DEPENDENCY_MANIFEST_REQUIRED: existing modules require package.json');
    if(!admitted.modules&&(!pkg||!Object.keys({...pkg.dependencies,...pkg.devDependencies,...pkg.optionalDependencies}).length))return{ignoredBuilds:[],dependencyFingerprint:digest};
    const modules=await lstat(join(source,'node_modules')).catch(error=>{if(error.code==='ENOENT')return null;throw error;}),cached=this.installed.get(key);
    if(cached?.fingerprint===digest&&modules?.isDirectory()&&!modules.isSymbolicLink()&&modules.dev===cached.dev&&modules.ino===cached.ino&&
      (!cached.localSourceDigest||cached.localSourceDigest===dependencyLocalSourceDigest(await inventoryPluginTree(source,{signal}))))return{ignoredBuilds:[],dependencyFingerprint:digest,...(cached.localSourceDigest?{localSourceDigest:cached.localSourceDigest}:{})};
    const privateRoot=join(this.ports.userData,'plugin-engineering',id),storeDir=join(this.ports.userData,'plugin-package-store');
    await mkdir(privateRoot,{recursive:true,mode:0o700});await mkdir(storeDir,{recursive:true,mode:0o700});
    const runtime=this.ports.runtime?.({id,privateRoot,storeDir})??managedRuntime(id,privateRoot,storeDir);
    try{
      const result=await installPluginDependencies({sourceRoot:source,privateRoot,storeDir,...runtime,signal,current:()=>this.ports.current(id,source),
        confirmBuilds:async packages=>{
          signal.throwIfAborted();const {dialog}=await import('electron');
          const response=await dialog.showMessageBox({type:'question',title:'Plugin dependency scripts',
            message:`Allow dependency build scripts for ${this.ports.name(id)}?`,
            detail:`These packages request installation scripts:\n\n${packages.join('\n')}\n\nScripts run in the managed plugin build process. Keep them off unless this plugin needs their generated files.`,
            buttons:['Keep scripts off','Allow these build scripts'],defaultId:0,cancelId:0,noLink:true});
          signal.throwIfAborted();return response.response===1?packages:[];
        }});
      await this.ports.warnings(id,result.ignoredBuilds.map(name=>`Installation scripts were skipped for ${name}. Approve this dependency only if its build step is required.`));
      signal.throwIfAborted();this.ports.current(id,source);
      if(dependencyFingerprint(source)!==result.dependencyFingerprint)throw new PluginSourceSupersededError();
      if(result.localSourceDigest&&dependencyLocalSourceDigest(await inventoryPluginTree(source,{signal}))!==result.localSourceDigest)throw new PluginSourceSupersededError();
      const published=await lstat(join(source,'node_modules')).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
      if(published?.isDirectory()&&!published.isSymbolicLink())this.installed.set(key,{fingerprint:result.dependencyFingerprint,localSourceDigest:result.localSourceDigest,dev:published.dev,ino:published.ino});
      return result;
    }catch(error){
      if(error instanceof Error&&/^PLUGIN_DEPENDENCY_SOURCE_(CHANGED|STALE|IDENTITY_CHANGED)/.test(error.message))throw new PluginSourceSupersededError();
      if(!(error instanceof AggregateError)&&!signal.aborted){
        let changed=false;try{changed=dependencyFingerprint(source)!==digest;}catch{/* Keep the original authority/command failure. */}
        if(changed)throw new PluginSourceSupersededError();
      }
      throw error;
    }
  }
  async close(){this.stop.abort(new Error('Plugin dependency installer closed'));await Promise.allSettled([...this.pending.values()]);}
}
function managedRuntime(id:string,privateRoot:string,storeDir:string):Runtime{
  const port=runtimePort(),pnpm=port.packagePath('pnpm');
  return{node:port.node().path,pnpm,run:pluginEngineeringRunner({identity:`plugin-install:${id}`,privateRoot,pnpm,
    readRoots:[dirname(pnpm)],writeRoots:[storeDir,privateRoot]})};
}
