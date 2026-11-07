/**
 * [INPUT]: Bounded source inventories, pinned source identity and confined local dependency paths.
 * [OUTPUT]: Copies source and generated module graphs without external links or unbounded files.
 * [POS]: Dependency transaction copying boundary; staging never runs inside the editable source inventory.
 */
import { mkdir, writeFile, lstat, readdir, readlink, realpath, symlink } from 'node:fs/promises';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { inventoryPluginTree, pluginHash, pluginBytesHash } from '../snapshot';
import { inside, readDependencyFile } from './model';

export async function stageDependencySource(source:string,destination:string,signal?:AbortSignal){
  const before=await inventoryPluginTree(source,{signal});await mkdir(destination,{mode:0o700});
  for(const file of before){
    signal?.throwIfAborted();const held=readDependencyFile(join(source,file.path),true);
    if(!held||pluginBytesHash(held.bytes)!==file.sha256)throw new Error('PLUGIN_DEPENDENCY_SOURCE_CHANGED');
    const target=join(destination,file.path);await mkdir(dirname(target),{recursive:true,mode:0o700});await writeFile(target,held.bytes,{flag:'wx',mode:Number(held.info.mode)&0o777});
  }
  if(pluginHash(before)!==pluginHash(await inventoryPluginTree(source,{signal})))throw new Error('PLUGIN_DEPENDENCY_SOURCE_CHANGED');
  await normalizeLocalInputs(source,destination,before.filter(file=>file.path==='package.json'||file.path.endsWith('/package.json')).map(file=>file.path));
  return{sourceDigest:pluginHash(before),files:before};
}
export async function normalizeLocalInputs(source:string,stage:string,manifests:readonly string[]){
  let localInputs=false;
  for(const name of manifests){
    const path=join(stage,name),held=readDependencyFile(path,true);if(!held)throw new Error('PLUGIN_DEPENDENCY_SOURCE_CHANGED');
    const pkg=JSON.parse(held.bytes.toString('utf8'));let changed=false;
    for(const group of [pkg.dependencies,pkg.devDependencies,pkg.optionalDependencies,pkg.peerDependencies,pkg.pnpm?.overrides]){
      if(!group||typeof group!=='object')continue;
      for(const [key,value] of Object.entries(group)){
        if(typeof value!=='string')continue;
        if(/(?:^|@)(file|link):.+$/.test(value)||/^(\.{1,2}\/|\/)/.test(value))localInputs=true;
        const normalized=await normalizeLocalPackage(value,source,dirname(join(source,name)));
        if(normalized!==value){group[key]=normalized;changed=true;}
      }
    }
    if(changed)await writeFile(path,JSON.stringify(pkg,null,2)+'\n',{mode:0o600});
  }
  return localInputs;
}
export async function normalizeLocalPackage(value:string,source:string,directory=source){
  const match=/(?:^|@)(file|link):(.+)$/.exec(value),plain=!match&&(/^(\.{1,2}\/|\/)/.test(value));
  if(!match&&!plain)return value;
  if(match?.[1]==='link')throw new Error('PLUGIN_DEPENDENCY_LINK_REQUIRES_FILE: use file: for a self-contained local dependency');
  const raw=decodeURIComponent(match?match[2]:value),target=resolve(directory,raw);
  if(raw.startsWith('//')||!inside(source,target))throw new Error('PLUGIN_DEPENDENCY_LOCAL_PATH_ESCAPES_SOURCE');
  const canonical=await realpath(target).catch(error=>{if(error.code==='ENOENT')throw new Error('PLUGIN_DEPENDENCY_LOCAL_PATH_MISSING');throw error;});
  if(!inside(source,canonical))throw new Error('PLUGIN_DEPENDENCY_LOCAL_PATH_ESCAPES_SOURCE');
  return isAbsolute(raw)||plain?(match?value.slice(0,-match[2].length):'file:')+'./'+relative(directory,target):value;
}

type TreeRow={path:string;kind:'file'|'directory'|'link';mode:number;bytes?:number;sha256?:string;link?:string};
export async function dependencyTree(root:string,sourceRoot:string,signal?:AbortSignal){
  const rows:TreeRow[]=[];let total=0;
  async function visit(directory:string){
    for(const name of (await readdir(directory)).sort()){
      signal?.throwIfAborted();const path=join(directory,name),info=await lstat(path),key=relative(root,path);
      if(rows.length>=100_000)throw new Error('PLUGIN_DEPENDENCY_TREE_BUDGET');
      if(info.isSymbolicLink()){
        const link=await readlink(path),target=await realpath(path);
        if(isAbsolute(link)||!inside(sourceRoot,target))throw new Error('PLUGIN_DEPENDENCY_MODULE_LINK_ESCAPES_SOURCE');
        rows.push({path:key,kind:'link',mode:info.mode&0o777,link});
      }else if(info.isDirectory()){
        rows.push({path:key,kind:'directory',mode:info.mode&0o777});await visit(path);
      }else{
        if(!info.isFile()||info.size>32*1024*1024)throw new Error('PLUGIN_DEPENDENCY_FILE_BUDGET');
        const held=readDependencyFile(path,true);if(!held)throw new Error('PLUGIN_DEPENDENCY_TREE_CHANGED');
        const content=held.bytes,after=await lstat(path);total+=content.length;
        if(total>768*1024*1024)throw new Error('PLUGIN_DEPENDENCY_TREE_BUDGET');
        if(info.ino!==after.ino||info.dev!==after.dev||info.mtimeMs!==after.mtimeMs||info.size!==content.length)throw new Error('PLUGIN_DEPENDENCY_TREE_CHANGED');
        rows.push({path:key,kind:'file',mode:info.mode&0o777,bytes:content.length,sha256:pluginBytesHash(content)});
      }
    }
  }
  const info=await lstat(root);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('PLUGIN_DEPENDENCY_MODULE_DIRECTORY_REQUIRED');
  await visit(root);return rows;
}
export async function copyDependencyTree(source:string,destination:string,stageRoot:string,signal?:AbortSignal){
  const before=await dependencyTree(source,stageRoot,signal);await mkdir(destination,{mode:0o700});
  for(const row of before){
    signal?.throwIfAborted();const path=join(destination,row.path);
    if(row.kind==='directory')await mkdir(path,{mode:row.mode});
    else if(row.kind==='link')await symlink(row.link!,path);
    else{
      const held=readDependencyFile(join(source,row.path),true);
      if(!held||pluginBytesHash(held.bytes)!==row.sha256)throw new Error('PLUGIN_DEPENDENCY_TREE_CHANGED');
      await writeFile(path,held.bytes,{flag:'wx',mode:row.mode});
    }
  }
  if(pluginHash(before)!==pluginHash(await dependencyTree(source,stageRoot,signal)))throw new Error('PLUGIN_DEPENDENCY_TREE_CHANGED');
  return before;
}
