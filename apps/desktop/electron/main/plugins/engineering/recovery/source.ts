/**
 * [INPUT]: Immutable source, a canonical Library path, private recovery storage and optional cancellation/ownership guards.
 * [OUTPUT]: Restores source bytes, preserves dependencies/Git, and rolls back failed or cancelled replacements.
 * [POS]: Code-only recovery transaction; business data and Widget configuration remain outside its paths.
 */
import {mkdir,readdir,rm,realpath,lstat} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {copyPluginSource} from '../snapshot';
const preserved=new Set(['node_modules','.git']);
async function clearSource(source:string){
  for(const entry of await readdir(source))if(!preserved.has(entry))await rm(join(source,entry),{recursive:true,force:true});
}
export async function restorePluginSource(input:{source:string;snapshot:string;backup:string;signal?:AbortSignal;assertCurrent?():void}){
  const assertCurrent=()=>{input.signal?.throwIfAborted();input.assertCurrent?.();input.signal?.throwIfAborted();};assertCurrent();
  const staged=join(input.backup,'replacement'),original=join(input.backup,'original');
  await mkdir(input.backup,{recursive:true,mode:0o700});
  // Finish validation and both copies before deleting a single current source file.
  await copyPluginSource(input.snapshot,staged);
  assertCurrent();
  const exists=await lstat(input.source).then(info=>{if(!info.isDirectory()||info.isSymbolicLink())throw new Error('PLUGIN_SOURCE_DIRECTORY_CHANGED');return true;},error=>{if(error.code==='ENOENT')return false;throw error;});
  if(exists){if(await realpath(input.source)!==input.source)throw new Error('PLUGIN_SOURCE_DIRECTORY_CHANGED');await copyPluginSource(input.source,original);}
  else{
    await mkdir(dirname(input.source),{recursive:true,mode:0o700});
    if(await realpath(dirname(input.source))!==dirname(input.source))throw new Error('PLUGIN_SOURCE_DIRECTORY_CHANGED');
    await mkdir(input.source,{mode:0o700});
  }
  try{assertCurrent();await clearSource(input.source);assertCurrent();await copyPluginSource(staged,input.source);assertCurrent();}
  catch(error){
    try{await clearSource(input.source);if(exists)await copyPluginSource(original,input.source);}
    catch(rollback){throw new AggregateError([error,rollback],'PLUGIN_SOURCE_RECOVERY_FAILED');}
    throw error;
  }
}
