/**
 * [INPUT]: Pinned source admission, private bounded snapshots, YAML, pinned pnpm and an owned process runner.
 * [OUTPUT]: Installs dependencies in private staging and returns an exact published-input receipt without overwriting author repairs.
 * [POS]: Online dependency phase; the offline compiler never invokes a package manager.
 */
import {writeFile,rm,readdir,mkdir,mkdtemp,realpath,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {lstatSync,realpathSync} from 'node:fs';
import {admitDependencySource,assertDependencyCurrent,assertDependencyFiles,inside,sameIdentity,optionalInfo,readDependencyFile,dependencyLocalSourceDigest,type DependencyInput,type DependencyReceipt} from './dependency/model';
import {stageDependencySource,normalizeLocalInputs,normalizeLocalPackage,dependencyTree} from './dependency/tree';
import {publishDependencyTransaction} from './dependency/publication';
import {assertPluginSourceRoot} from '../process/source-root';

export const PLUGIN_PNPM_VERSION='11.9.0';
export const PLUGIN_SHADCN_VERSION='4.23.0';
export type PluginCommand={command:string;args:readonly string[];cwd:string;network:boolean;signal?:AbortSignal};
export type PluginCommandResult={exitCode:number;stdout:string;stderr:string};
const nullableBytes=async(path:string)=>readDependencyFile(path,true)?.bytes??null;
const pending=new Map<string,Promise<unknown>>();

export function installPluginDependencies(input:DependencyInput):Promise<DependencyReceipt>{
  const key=resolve(input.sourceRoot),previous=pending.get(key)??Promise.resolve();
  const task=previous.catch(()=>{}).then(()=>install(input));pending.set(key,task);
  void task.finally(()=>{if(pending.get(key)===task)pending.delete(key);}).catch(()=>{});return task;
}
async function install(input:DependencyInput):Promise<DependencyReceipt>{
  assertDependencyCurrent(input);await assertPluginSourceRoot(input.sourceRoot);const source=admitDependencySource(input.sourceRoot);
  const operation=input.operation;
  if(operation?.packages.some(value=>!value||value.startsWith('-')||/[\s\0]/.test(value)))throw new Error('PLUGIN_DEPENDENCY_INVALID');
  const packages=operation?await Promise.all(operation.packages.map(value=>normalizeLocalPackage(value,source.root))):[];
  if(!input.privateRoot||inside(source.root,resolve(input.privateRoot)))throw new Error('PLUGIN_DEPENDENCY_PRIVATE_STAGE_INSIDE_SOURCE');
  await mkdir(input.privateRoot,{recursive:true,mode:0o700});
  const privateRoot=await realpath(input.privateRoot);if(privateRoot!==resolve(input.privateRoot))throw new Error('PLUGIN_DEPENDENCY_PRIVATE_CANONICAL_DIRECTORY_REQUIRED');
  const privateInfo=lstatSync(privateRoot,{bigint:true}),transaction=await mkdtemp(join(privateRoot,'install-')),stage=join(transaction,'source'),transactionInfo=lstatSync(transaction,{bigint:true});
  const privateIdentity=()=>{
    const directory=optionalInfo(transaction),parent=optionalInfo(privateRoot);
    if(!directory||!parent||!sameIdentity(directory,transactionInfo)||!sameIdentity(parent,privateInfo)||directory.isSymbolicLink()||parent.isSymbolicLink()||realpathSync(transaction)!==transaction)throw new Error('PLUGIN_DEPENDENCY_PRIVATE_IDENTITY_CHANGED');
  };
  const execution={...input,current:()=>{input.current?.();privateIdentity();}};
  try{
  privateIdentity();const snapshot=await stageDependencySource(source.root,stage,input.signal);assertDependencyFiles(source);assertDependencyCurrent(execution);
  const {parse,stringify}=await import('yaml');
  const config=await nullableBytes(join(stage,'pnpm-workspace.yaml'));
  const previous=config?parse(config.toString('utf8')):null;
  const workspace:Record<string,unknown>=previous&&typeof previous==='object'&&!Array.isArray(previous)?previous:{};
  // The host owns execution policy even when an author changes project configuration.
  Object.assign(workspace,{packages:['.'],storeDir:input.storeDir,ignorePnpmfile:true,ignoreScripts:true,strictPeerDependencies:true,
    dangerouslyAllowAllBuilds:false,managePackageManagerVersions:false});
  const allowed=workspace.allowBuilds&&typeof workspace.allowBuilds==='object'?workspace.allowBuilds as Record<string,boolean>:{};
  workspace.allowBuilds=Object.fromEntries(Object.keys(allowed).map(name=>[name,false]));
    await writeFile(join(stage,'pnpm-workspace.yaml'),stringify(workspace),{mode:0o600});
    const args=operation?[operation.kind,...(operation.kind==='add'?['--save-exact']:[]),...packages]:['install','--no-frozen-lockfile'];
    const result=await input.run({command:input.node,args:[input.pnpm,...args,operation?.kind==='remove'?'--config.ignore-scripts=true':'--ignore-scripts','--reporter=append-only','--loglevel=warn'],cwd:stage,network:true,signal:input.signal});
    assertDependencyCurrent(execution);
    if(await lstat(join(stage,'node_modules')).catch(error=>{if(error.code==='ENOENT')return null;throw error;}))await dependencyTree(join(stage,'node_modules'),stage,input.signal);
    const ignored=await ignoredBuilds(stage);
    workspace.allowBuilds=Object.fromEntries(ignored.map(name=>[name,false]));
    await writeFile(join(stage,'pnpm-workspace.yaml'),stringify(workspace),{mode:0o600});
    if(result.exitCode!==0&&!/ERR_PNPM_IGNORED_BUILDS/.test(result.stdout+result.stderr))throw new Error((result.stderr||result.stdout||'PLUGIN_DEPENDENCY_INSTALL_FAILED').slice(-8192));
    const approved=ignored.length&&input.confirmBuilds?await input.confirmBuilds(ignored):[];
    assertDependencyCurrent(execution);
    if(approved.some(name=>!ignored.includes(name)))throw new Error('PLUGIN_BUILD_APPROVAL_INVALID');
    if(approved.length){
      workspace.allowBuilds=Object.fromEntries(ignored.map(name=>[name,approved.includes(name)]));
      await writeFile(join(stage,'pnpm-workspace.yaml'),stringify(workspace),{mode:0o600});
      const rebuilt=await input.run({command:input.node,args:[input.pnpm,'rebuild',...approved,'--config.ignore-scripts=false','--reporter=append-only','--loglevel=warn'],cwd:stage,network:true,signal:input.signal});
      assertDependencyCurrent(execution);
      if(rebuilt.exitCode!==0)throw new Error((rebuilt.stderr||rebuilt.stdout||'PLUGIN_DEPENDENCY_BUILD_FAILED').slice(-8192));
    }
    assertDependencyFiles(source);const localInputs=await normalizeLocalInputs(source.root,stage,['package.json']);
    await mkdir(join(stage,'node_modules'),{recursive:true,mode:0o700});
    const dependencyFingerprint=await publishDependencyTransaction({source,stage,sourceDigest:snapshot.sourceDigest,execution});
    return{ignoredBuilds:ignored.filter(name=>!approved.includes(name)),approvedBuilds:[...approved],pnpmVersion:PLUGIN_PNPM_VERSION,dependencyFingerprint,
      ...(localInputs?{localSourceDigest:dependencyLocalSourceDigest(snapshot.files)}:{})};
  }finally{privateIdentity();await rm(transaction,{recursive:true,force:true});}
}

async function ignoredBuilds(sourceRoot:string):Promise<string[]>{
  const {parse}=await import('yaml');
  const root=join(sourceRoot,'node_modules','.pnpm');
  const ignored=new Set<string>();
  const modules=await nullableBytes(join(sourceRoot,'node_modules','.modules.yaml'));
  if(modules){const metadata=parse(modules.toString('utf8'));for(const id of [...(metadata?.ignoredBuilds??[]),...(metadata?.pendingBuilds??[])]){
    if(typeof id==='string'){const name=id.replace(/^.*node_modules\//,'').replace(/@[^@/]+$/,'');if(name&&name!=='.')ignored.add(name);}
  }}
  for(const entry of await readdir(root,{withFileTypes:true}).catch(()=>[])){
    if(!entry.isDirectory()||entry.name==='node_modules')continue;
    const dependencies=join(root,entry.name,'node_modules');
    const packages=await readdir(dependencies,{withFileTypes:true});
    for(const pkg of packages){
      const names=pkg.name.startsWith('@')?await readdir(join(dependencies,pkg.name)).then(values=>values.map(name=>`${pkg.name}/${name}`)):[pkg.name];
      for(const name of names){const canonical=await realpath(join(dependencies,name,'package.json')).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(!canonical)continue;
        if(!inside(sourceRoot,canonical))throw new Error('PLUGIN_DEPENDENCY_MODULE_LINK_ESCAPES_SOURCE');
        const bytes=await nullableBytes(canonical);if(!bytes)continue;
        const json=JSON.parse(bytes.toString('utf8'));if(['preinstall','install','postinstall'].some(key=>json.scripts?.[key]))ignored.add(json.name);
      }
    }
  }
  return[...ignored].sort();
}
