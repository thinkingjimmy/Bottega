/**
 * [INPUT]: Source files, pnpm's source-local dependency graph, identity/hash digests and fixed snapshot budgets and the shared recursive-source sensitive-path policy.
 * [OUTPUT]: D9-guarded source roots, descriptor-consistent snapshots, source-only copies and bounded inventories without external links.
 * [POS]: Build input boundary; runtime packages contain bundled outputs instead of a source machine's node_modules.
 */
import {mkdir,readdir,lstat,open,writeFile,readlink,realpath,cp} from 'node:fs/promises';
import {constants,type Stats} from 'node:fs';
import {assertPluginSourceRoot} from '../process/source-root';
import type {PluginPathScope} from '../process/paths';
import {join,relative,resolve,sep} from 'node:path';
import {pluginHash,pluginBytesHash} from './identity/hash';
export {pluginHash,pluginBytesHash} from './identity/hash';
export type SnapshotFile={path:string;bytes:number;sha256:string};
const contains=(root:string,path:string)=>path===root||path.startsWith(root+sep);
async function sourceBytes(path:string,expected?:Stats){
  const before=expected??await lstat(path);
  if(!before.isFile()||before.isSymbolicLink()||before.size>32*1024*1024||await realpath(path)!==path)throw new Error('PLUGIN_SOURCE_FILE_INVALID');
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const actual=await file.stat();
    if(!actual.isFile()||actual.dev!==before.dev||actual.ino!==before.ino||actual.size!==before.size||actual.mtimeMs!==before.mtimeMs)throw new Error('PLUGIN_SOURCE_CHANGED_DURING_SNAPSHOT');
    const content=await file.readFile(),after=await lstat(path);
    if(after.isSymbolicLink()||actual.dev!==after.dev||actual.ino!==after.ino||before.mtimeMs!==after.mtimeMs||before.size!==content.length||await realpath(path)!==path)throw new Error('PLUGIN_SOURCE_CHANGED_DURING_SNAPSHOT');
    return content;
  }finally{await file.close();}
}

export async function copyPluginSource(from:string,to:string,scope?:PluginPathScope){
  const root=await assertPluginSourceRoot(from,scope);
  async function copy(directory:string,destination:string){
    await mkdir(destination,{recursive:true,mode:0o700});
    for(const entry of await readdir(directory,{withFileTypes:true})){
      if(['node_modules','.git','.DS_Store'].includes(entry.name))continue;
      const source=join(directory,entry.name),target=join(destination,entry.name),info=await lstat(source);
      if(info.isSymbolicLink()||!info.isFile()&&!info.isDirectory()||await realpath(source)!==source)throw new Error('PLUGIN_SOURCE_LINK_UNSUPPORTED');
      if(info.isDirectory())await copy(source,target);
      else await writeFile(target,await sourceBytes(source,info),{flag:'wx',mode:0o600}).catch(error=>{if(error.code!=='EEXIST')throw error;});
    }
  }
  await copy(root,to);
}

export async function inventoryPluginTree(root:string,options:{dependencies?:boolean;signal?:AbortSignal;pathScope?:PluginPathScope}={}):Promise<SnapshotFile[]>{
  const canonical=await assertPluginSourceRoot(root,options.pathScope),files:SnapshotFile[]=[];let bytes=0;
  async function visit(directory:string){
    for(const name of (await readdir(directory)).sort()){
      options.signal?.throwIfAborted();
      if(name==='.git'||name==='.DS_Store'||name==='node_modules'&&!options.dependencies)continue;
      const path=join(directory,name),info=await lstat(path),key=relative(canonical,path).split(sep).join('/');
      if(info.isSymbolicLink()){
        const target=await realpath(path);
        if(!options.dependencies||!contains(canonical,target))throw new Error(`PLUGIN_SOURCE_EXTERNAL_LINK: ${key}`);
        files.push({path:key,bytes:0,sha256:pluginHash({link:relative(directory,resolve(directory,await readlink(path)))})});continue;
      }
      if(info.isDirectory()){await visit(path);continue;}
      if(!info.isFile()||info.nlink<1||info.size>32*1024*1024)throw new Error(`PLUGIN_SOURCE_FILE_INVALID: ${key}`);
      const content=await sourceBytes(path,info);
      bytes+=content.length;if(bytes>768*1024*1024||files.length>=100000)throw new Error('PLUGIN_SOURCE_BUDGET');
      files.push({path:key,bytes:content.length,sha256:pluginBytesHash(content)});
    }
  }
  await visit(canonical);return files;
}

export async function freezePluginSource(source:string,destination:string,signal?:AbortSignal,scope?:PluginPathScope){
  const root=await assertPluginSourceRoot(source,scope),before=await inventoryPluginTree(root,{signal,pathScope:scope});
  await mkdir(destination,{recursive:true,mode:0o700});
  for(const file of before){signal?.throwIfAborted();const path=join(destination,file.path);await mkdir(resolve(path,'..'),{recursive:true,mode:0o700});const bytes=await sourceBytes(join(root,file.path));
    if(pluginBytesHash(bytes)!==file.sha256)throw new Error('PLUGIN_SOURCE_CHANGED_DURING_SNAPSHOT');await writeFile(path,bytes,{mode:0o600});}
  const after=await inventoryPluginTree(root,{signal,pathScope:scope});if(pluginHash(before)!==pluginHash(after))throw new Error('PLUGIN_SOURCE_CHANGED_DURING_SNAPSHOT');
  const modules=join(root,'node_modules');
  let dependencies:SnapshotFile[]=[];
  if(await lstat(modules).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;})){
    dependencies=await inventoryPluginTree(modules,{dependencies:true,signal,pathScope:scope});
    await cp(modules,join(destination,'node_modules'),{recursive:true,dereference:false,verbatimSymlinks:true});
    const frozen=await inventoryPluginTree(join(destination,'node_modules'),{dependencies:true,signal,pathScope:scope});
    if(pluginHash(dependencies)!==pluginHash(frozen))throw new Error('PLUGIN_DEPENDENCIES_CHANGED_DURING_SNAPSHOT');
  }
  return{files:before,sourceDigest:pluginHash(before),dependencyDigest:pluginHash(dependencies)};
}
