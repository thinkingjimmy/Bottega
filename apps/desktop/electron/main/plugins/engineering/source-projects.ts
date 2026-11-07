/**
 * [INPUT]: Selected Library, durable operations, canonical Projects and distinct source/package directory bindings.
 * [OUTPUT]: PluginSourceProjects prepares source Projects and original-source personal copies, forwarding instance targets only for a new copy.
 * [POS]: Source ownership has no author Chat; normal Chat creation supplies any number of authoring sessions.
 */
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,realpath,writeFile,lstat} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {z} from 'zod';
import {unifiedPluginManifestSchema,pluginPrepareAuthoringInputSchema,type PluginPrepareAuthoringInput,type UnifiedPluginManifest} from '@bottega/contracts/plugins/platform';
import {DurableJson} from '../../persistence/durable-json';
import {libraryDirectory,isUnder} from '../../library/paths';
import {assertLibraryOutsideUserData} from '../../library/safety/admission';
import {canonicalDigest} from '../../apps/support';
import {copyPluginSource} from './snapshot';

type Binding={sourceDirectory?:string;packageDirectory?:string;projectId?:string;editable?:boolean};
type Ports={userData:string;libraryRoot():string|null;projectDirectories():Iterable<string>;
  lookup(id:string):Binding|undefined|null;
  commitProject(path:string,name:string):Promise<{id:string;membershipRevision:number}>;
  register(input:{manifest:UnifiedPluginManifest;sourceDirectory:string;projectId:string;instanceId?:string}):Promise<void>};
const operation=z.object({id:z.string(),request:z.string(),library:z.string(),pluginId:z.string(),source:z.string(),projectId:z.string().optional(),completed:z.boolean()}).strict();
const ledger=z.object({version:z.literal(1),operations:z.array(operation)}).strict();
export type PreparedPluginSource={pluginId:string;projectId:string;workspacePath:string;workspacePrecondition:{kind:'project';projectId:string;membershipRevision:number}};

export class PluginSourceProjects{
  private readonly file:DurableJson<z.infer<typeof ledger>>;
  private tail:Promise<unknown>=Promise.resolve();
  private closed=false;
  constructor(private readonly ports:Ports){this.file=new DurableJson(join(ports.userData,'plugin-authoring-operations.json'),ledger,()=>({version:1,operations:[]}));}
  initialize(){return this.file.initialize();}
  prepare(input:PluginPrepareAuthoringInput):Promise<PreparedPluginSource>{
    if(this.closed)return Promise.reject(new Error('PLUGIN_AUTHORING_CLOSED'));
    const request=pluginPrepareAuthoringInputSchema.parse(input);
    const next=this.tail.then(()=>this.prepareCurrent(request));this.tail=next.catch(()=>{});return next;
  }
  private async prepareCurrent(input:PluginPrepareAuthoringInput):Promise<PreparedPluginSource>{
    const selected=this.ports.libraryRoot();if(!selected)throw new Error('PLUGIN_LIBRARY_NOT_CONFIGURED');
    const library=await realpath(selected);await assertLibraryOutsideUserData(library,this.ports.userData);
    const request=canonicalDigest(input);
    let entry=this.file.snapshot().operations.find(value=>value.id===input.operationId);
    if(entry&&(entry.library!==library||entry.request!==request))throw new Error('PLUGIN_AUTHORING_OPERATION_CONFLICT');
    if(entry?.completed){
      const manifest=unifiedPluginManifestSchema.parse(JSON.parse(await readFile(join(entry.source,'bottega.plugin.json'),'utf8')));
      if(manifest.id!==entry.pluginId)throw new Error('PLUGIN_SOURCE_IDENTITY_CHANGED');
      const project=await this.ports.commitProject(entry.source,manifest.name);await this.assertLibrary(library);
      return{pluginId:entry.pluginId,projectId:project.id,workspacePath:entry.source,workspacePrecondition:{kind:'project',projectId:project.id,membershipRevision:project.membershipRevision}};
    }
    const existing=input.kind==='plugin'&&input.pluginId?this.ports.lookup(input.pluginId):null;
    if(input.kind==='plugin'&&!existing)throw new Error('PLUGIN_NOT_FOUND');
    const source=existing?.sourceDirectory??(existing?.packageDirectory?await packageSource(existing.packageDirectory):undefined);
    let original:UnifiedPluginManifest|undefined;
    if(source){try{original=unifiedPluginManifestSchema.parse(JSON.parse(await readFile(join(source,'bottega.plugin.json'),'utf8')));}
      catch(error){throw new Error('PLUGIN_SOURCE_MISSING: Locate the plugin source folder before editing.',{cause:error});}}
    const copying=Boolean(input.copy||existing?.editable===false||original&&(!original.source.editable||original.source.kind==='official'));
    if(original?.source.format!=='bottega'&&original)throw new Error('PLUGIN_EXTERNAL_FORMAT_NOT_EDITABLE');
    if(!entry){
      const pluginId=source&&!copying?input.pluginId!:`plugin-${randomUUID()}`;
      const root=source&&!copying?await realpath(source):join(await libraryDirectory(library,'plugins',pluginId),'source');
      await this.assertSourceLocation(root,source&&!copying?root:undefined);
      entry={id:input.operationId,request,library,pluginId,source:root,completed:false};
      const created=entry;await this.file.mutate(state=>{state.operations.push(created);});
    }
    await this.assertSourceLocation(entry.source,entry.completed?entry.source:source&&!copying?entry.source:undefined);
    let manifest:UnifiedPluginManifest;
    if(source&&!copying){manifest=original!;}
    else{
      await mkdir(entry.source,{recursive:true,mode:0o700});
      if(await realpath(entry.source)!==entry.source)throw new Error('PLUGIN_SOURCE_DIRECTORY_CHANGED');
      if(copying&&source){
        await copyPluginSource(source,entry.source);
        const {providerAlias:_alias,...copied}=original!;
        manifest=unifiedPluginManifestSchema.parse({...copied,id:entry.pluginId,name:input.name??`${original!.name} copy`,
          source:{kind:'copy',format:'bottega',editable:true,pluginId:original!.id}});
        // A copied mode must select its own tools instead of silently calling the official original.
        manifest.contributions=manifest.contributions.map(value=>value.kind==='mode'?{...value,tools:{...value.tools,plugins:value.tools.plugins.map(id=>id===original!.id?entry!.pluginId:id)}}:value);
        await writeFile(join(entry.source,'bottega.plugin.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
      }else{
        const {pluginTemplate}=await import('./template');
        const template=pluginTemplate(entry.pluginId,input.name??'Untitled plugin');manifest=template.manifest;
        for(const [path,bytes]of Object.entries(template.files)){
          const target=join(entry.source,path);await mkdir(dirname(target),{recursive:true,mode:0o700});
          await writeFile(target,bytes,{flag:'wx',mode:0o600}).catch(error=>{if(error.code!=='EEXIST')throw error;});
        }
        manifest=unifiedPluginManifestSchema.parse(JSON.parse(await readFile(join(entry.source,'bottega.plugin.json'),'utf8')));
      }
    }
    if(manifest.id!==entry.pluginId)throw new Error('PLUGIN_SOURCE_IDENTITY_CHANGED');
    await this.assertLibrary(library);
    const project=await this.ports.commitProject(entry.source,manifest.name);await this.assertLibrary(library);
    await this.ports.register({manifest,sourceDirectory:entry.source,projectId:project.id,...(copying&&input.instanceId?{instanceId:input.instanceId}:{})});
    await this.file.mutate(state=>{const value=state.operations.find(value=>value.id===input.operationId)!;value.projectId=project.id;value.completed=true;});
    return{pluginId:entry.pluginId,projectId:project.id,workspacePath:entry.source,
      workspacePrecondition:{kind:'project',projectId:project.id,membershipRevision:project.membershipRevision}};
  }
  private async assertLibrary(library:string){const selected=this.ports.libraryRoot();if(this.closed||!selected||await realpath(selected)!==library)throw new Error('PLUGIN_AUTHORING_LIBRARY_CHANGED');}
  private async assertSourceLocation(source:string,allow?:string){
    await assertLibraryOutsideUserData(source,this.ports.userData);
    for(const project of this.ports.projectDirectories()){
      const canonical=await realpath(project).catch(()=>project);if(canonical===allow)continue;
      if(isUnder(source,canonical)||isUnder(canonical,source))throw new Error('PLUGIN_SOURCE_PROJECT_OVERLAP');
    }
  }
  async close(){this.closed=true;await this.tail;await this.file.closeAndFlush();}
}

async function packageSource(directory:string){
  const descriptor=await lstat(join(directory,'plugin-package.json')).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(descriptor&&(!descriptor.isFile()||descriptor.isSymbolicLink()))throw new Error('PLUGIN_PACKAGE_SOURCE_METADATA_INVALID');
  return descriptor?join(directory,'source'):directory;
}
