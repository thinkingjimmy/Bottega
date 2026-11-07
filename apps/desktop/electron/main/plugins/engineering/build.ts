/**
 * [INPUT]: Unified manifests, exact installed-input receipts, frozen source/dependencies, the bundled offline compiler and canonical package contracts.
 * [OUTPUT]: Content-derived complete immutable plugin revisions with source recovery and receiver-verifiable descriptors.
 * [POS]: Engineering build coordinator; only the platform activation record makes a candidate live.
 */
import {mkdir,readFile,writeFile,mkdtemp,rename,rm,chmod,realpath} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {basename} from 'node:path';
import {unifiedPluginManifestSchema,unifiedPluginDistributionSchema,unifiedPluginRevisionId,type UnifiedPluginManifest,type UnifiedPluginRevision} from '@bottega/contracts/plugins/platform';
import {runtimePort} from '../../runtime';
import {freezePluginSource,inventoryPluginTree,pluginHash,pluginBytesHash,copyPluginSource} from './snapshot';
import {pluginEngineeringRunner} from './execution';
import {dependencyFingerprint,dependencyLocalSourceDigest} from './dependency/model';
import {PluginSourceSupersededError} from '../platform/model';
export type PluginCompileInput={sourceRoot:string;outputRoot:string;manifest:UnifiedPluginManifest};
export type PluginCompileResult={manifest:UnifiedPluginManifest};
type Input={sourceRoot:string;buildsRoot:string;sourceVersion:number;signal?:AbortSignal;dependencyFingerprint?:string;dependencyLocalSourceDigest?:string;
  compile?:(input:PluginCompileInput)=>Promise<PluginCompileResult>};

export async function buildUnifiedPlugin(input:Input){
  await mkdir(input.buildsRoot,{recursive:true,mode:0o700});
  const stage=await realpath(await mkdtemp(join(input.buildsRoot,'.candidate-')));
  try{
    const sourceRoot=join(stage,'snapshot'),outputRoot=join(stage,'package');
    const frozen=await freezePluginSource(input.sourceRoot,sourceRoot,input.signal);
    if(input.dependencyFingerprint&&dependencyFingerprint(sourceRoot)!==input.dependencyFingerprint)throw new PluginSourceSupersededError();
    if(input.dependencyLocalSourceDigest&&dependencyLocalSourceDigest(frozen.files)!==input.dependencyLocalSourceDigest)throw new PluginSourceSupersededError();
    const manifest=unifiedPluginManifestSchema.parse(JSON.parse(await readFile(join(sourceRoot,'bottega.plugin.json'),'utf8')));
    if(!manifest.requirements.platforms.includes(process.platform as 'darwin'))throw new Error('PLUGIN_PLATFORM_UNSUPPORTED');
    await mkdir(outputRoot,{mode:0o700});
    const compiled=await(input.compile??compileInManagedProcess)({sourceRoot,outputRoot,manifest},input.signal,stage);
    input.signal?.throwIfAborted();
    await copyPluginSource(sourceRoot,join(outputRoot,'source'));
    await writeFile(join(outputRoot,'bottega.plugin.json'),JSON.stringify(compiled.manifest,null,2)+'\n',{mode:0o600});
    const files=(await inventoryPluginTree(outputRoot)).map(file=>({...file,role:file.path.startsWith('source/')?'source' as const:file.path.startsWith('runtime/')?'runtime' as const:'metadata' as const}));
    const lock=await readFile(join(sourceRoot,'pnpm-lock.yaml')).catch(error=>{if(error.code==='ENOENT')return Buffer.alloc(0);throw error;});
    const compilerIdentity=input.compile?{injectedCompiler:String(input.compile)}:{compilerBytes:pluginBytesHash(await readFile(runtimePort().entryPath('plugin-compiler')))};
    const identity={pluginId:manifest.id,sourceDigest:frozen.sourceDigest,manifestDigest:pluginHash(compiled.manifest),lockDigest:pluginBytesHash(lock),
      dependencyDigest:frozen.dependencyDigest,toolchainDigest:pluginHash({compiler:'bottega-unified-plugin/v1',...compilerIdentity,esbuild:'0.28.1',tailwind:'4.3.2',node:24,sdk:1}),
      contentDigest:pluginHash(files),target:{platform:'darwin' as const,arch:process.arch as 'arm64'|'x64',nodeMajor:24,sdkVersion:1 as const},dataContract:manifest.dataContract};
    const distribution=unifiedPluginDistributionSchema.parse({format:'bottega-plugin/v1',schemaVersion:1,...identity,
      revisionId:unifiedPluginRevisionId(identity),manifest:compiled.manifest,files});
    await writeFile(join(outputRoot,'plugin-package.json'),JSON.stringify(distribution,null,2)+'\n',{mode:0o600});
    const parent=join(input.buildsRoot,manifest.id),rootDirectory=join(parent,distribution.revisionId.slice(7));
    await mkdir(parent,{recursive:true,mode:0o700});
    try{await rename(outputRoot,rootDirectory);}
    catch(error){
      if(!['EEXIST','ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code??''))throw error;
      const previous=unifiedPluginDistributionSchema.parse(JSON.parse(await readFile(join(rootDirectory,'plugin-package.json'),'utf8')));
      if(pluginHash(previous)!==pluginHash(distribution))throw new Error('PLUGIN_IMMUTABLE_REVISION_CONFLICT');
      for(const file of previous.files)if(pluginBytesHash(await readFile(join(rootDirectory,file.path)))!==file.sha256)throw new Error('PLUGIN_IMMUTABLE_REVISION_CHANGED');
    }
    for(const file of [...files.map(value=>value.path),'plugin-package.json'])await chmod(join(rootDirectory,file),0o400);
    const revision:UnifiedPluginRevision={pluginId:manifest.id,revisionId:distribution.revisionId,sourceVersion:input.sourceVersion,createdAt:Date.now(),rootDirectory,
      manifest:compiled.manifest,packageDigest:pluginHash(distribution),dataContract:manifest.dataContract,valid:true};
    return{revision,distribution};
  }finally{await rm(stage,{recursive:true,force:true});}
}

async function compileInManagedProcess(input:PluginCompileInput,signal?:AbortSignal,stage?:string):Promise<PluginCompileResult>{
  if(!stage)throw new Error('PLUGIN_BUILD_STAGE_REQUIRED');
  const port=runtimePort(),entry=port.entryPath('plugin-compiler');
  const productRequire=createRequire(entry),dependency=await realpath(productRequire.resolve('esbuild/package.json'));
  const dependencyRoots:string[]=[];
  for(let path=dirname(dependency);path!==dirname(path);path=dirname(path))if(basename(path)==='node_modules'||basename(path)==='.pnpm')dependencyRoots.push(path);
  // Node must traverse the product's package links before reaching their canonical dependency bytes.
  const productModules=await realpath(resolve(dirname(entry),'../../node_modules'));
  const request=join(stage,'request.json'),result=join(stage,'result.json');
  await writeFile(request,JSON.stringify(input),{mode:0o600});
  const run=pluginEngineeringRunner({identity:`plugin-build:${input.manifest.id}`,privateRoot:stage,
    readRoots:[input.sourceRoot,dirname(entry),dirname(dirname(entry)),dirname(port.node().path),productModules,...dependencyRoots],writeRoots:[stage]});
  const execution=await run({command:port.node().path,args:[entry,request,result],cwd:stage,network:false,signal});
  if(execution.exitCode!==0)throw new Error((execution.stderr||execution.stdout||'PLUGIN_BUILD_FAILED').slice(-8192));
  return JSON.parse(await readFile(result,'utf8')) as PluginCompileResult;
}
