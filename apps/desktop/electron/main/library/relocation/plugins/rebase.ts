/**
 * [INPUT]: Relocation's verified old/new roots, private plugin ledgers and portable Project hints.
 * [OUTPUT]: Idempotent source/accepted-source-receipt rebasing and exclusion of regenerable plugin dependencies from Library moves.
 * [POS]: Runs before plugin and Project owners open; runtime builds and business data remain in userData.
 */
import {lstat,readdir,readFile,rm,realpath} from 'node:fs/promises';
import {join,relative,sep} from 'node:path';
import {durableReplaceFile} from '../../../persistence/durable-json';
const rebase=(path:string,from:string,to:string)=>path===from||path.startsWith(from+sep)?to+path.slice(from.length):path;
const readJson=async(path:string)=>readFile(path,'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
export const isPluginDependencyPath=(root:string,path:string)=>/^plugins\/[A-Za-z0-9_-]{1,128}\/source\/node_modules(?:\/|$)/.test(relative(root,path).split(sep).join('/'));

export async function prunePluginDependencies(root:string){
  const plugins=join(await realpath(root),'plugins');
  for(const entry of await readdir(plugins,{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return[];throw error;})){
    if(!entry.isDirectory()||!/^[A-Za-z0-9_-]{1,128}$/.test(entry.name))continue;
    const source=join(plugins,entry.name,'source');
    try{
      if(await realpath(source)!==source||(await lstat(source)).isSymbolicLink())continue;
      const declaration=await readJson(join(source,'bottega.plugin.json'));if(declaration?.id!==entry.name)continue;
      await rm(join(source,'node_modules'),{recursive:true,force:true});
    }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  }
}

export async function rebasePluginSources(userData:string,from:string,to:string){
  const platformPath=join(userData,'plugin-platform.json'),platform=await readJson(platformPath);
  if(platform){
    for(const plugin of platform.plugins??[]){
      for(const key of ['packageDirectory','sourceDirectory'])if(typeof plugin.directory?.[key]==='string')plugin.directory[key]=rebase(plugin.directory[key],from,to);
      if(typeof plugin.sourceProject?.sourceDirectory==='string')plugin.sourceProject.sourceDirectory=rebase(plugin.sourceProject.sourceDirectory,from,to);
      if(typeof plugin.sourceBuild?.sourceDirectory==='string')plugin.sourceBuild.sourceDirectory=rebase(plugin.sourceBuild.sourceDirectory,from,to);
    }
    await durableReplaceFile(platformPath,JSON.stringify(platform,null,2)+'\n');
  }
  const operationsPath=join(userData,'plugin-authoring-operations.json'),operations=await readJson(operationsPath);
  if(operations){for(const operation of operations.operations??[]){if(typeof operation.library==='string')operation.library=rebase(operation.library,from,to);if(typeof operation.source==='string')operation.source=rebase(operation.source,from,to);}
    await durableReplaceFile(operationsPath,JSON.stringify(operations,null,2)+'\n');}
  const projects=join(to,'projects');
  for(const project of await readdir(projects,{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return[];throw error;})){
    if(!project.isDirectory())continue;
    const path=join(projects,project.name,'local-hints.json'),hints=await readJson(path);if(!hints)continue;
    for(const hint of Object.values(hints.hints??{}) as Array<{dir?:string}>)if(typeof hint.dir==='string')hint.dir=rebase(hint.dir,from,to);
    await durableReplaceFile(path,JSON.stringify(hints,null,2)+'\n');
  }
}
