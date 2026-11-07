/**
 * [INPUT]: Complete plugin descriptors, canonical identities, contained regular files and the local immutable build directory.
 * [OUTPUT]: Imports verified precompiled plugins without installing dependencies or compiling on the receiving computer.
 * [POS]: Shared local/external receiver boundary; transport review remains responsible for user acceptance.
 */
import {mkdir,readFile,realpath,writeFile,rename,rm,mkdtemp,chmod} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {unifiedPluginDistributionSchema,type UnifiedPluginRevision} from '@bottega/contracts/plugins/platform';
import {pluginHash,pluginBytesHash} from '../engineering/snapshot';
import {verifyUnifiedPluginDistribution} from '../distribution/verify';

export async function importPluginDistribution(input:{directory:string;buildsRoot:string;sourceVersion:number}):Promise<UnifiedPluginRevision>{
  let checked: Awaited<ReturnType<typeof verifyUnifiedPluginDistribution>>;
  try { checked = await verifyUnifiedPluginDistribution(input.directory); }
  catch (cause) { throw new Error(`PLUGIN_PACKAGE_DIGEST_MISMATCH: ${(cause as Error).message}`); }
  const descriptor = checked.distribution;
  const verified = new Map([...checked.files].filter(([path]) => path !== 'plugin-package.json'));
  const parent=join(input.buildsRoot,descriptor.pluginId);await mkdir(parent,{recursive:true,mode:0o700});
  const destination=join(parent,descriptor.revisionId.slice(7)),stage=await mkdtemp(join(parent,'.receive-'));
  try{
    for(const[path,bytes]of verified){const target=join(stage,path);await mkdir(dirname(target),{recursive:true,mode:0o700});await writeFile(target,bytes,{mode:0o400});}
    await writeFile(join(stage,'plugin-package.json'),JSON.stringify(descriptor,null,2)+'\n',{mode:0o400});
    try{await rename(stage,destination);}
    catch(error){if(!['EEXIST','ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code??''))throw error;
      const previous=unifiedPluginDistributionSchema.parse(JSON.parse(await readFile(join(destination,'plugin-package.json'),'utf8')));
      if(pluginHash(previous)!==pluginHash(descriptor))throw new Error('PLUGIN_PACKAGE_IMMUTABLE_CONFLICT');
      for(const file of descriptor.files)if(pluginBytesHash(await readFile(join(destination,file.path)))!==file.sha256)throw new Error('PLUGIN_PACKAGE_DIGEST_MISMATCH');}
    await chmod(destination,0o700);
  }finally{await rm(stage,{recursive:true,force:true});}
  return{pluginId:descriptor.pluginId,revisionId:descriptor.revisionId,sourceVersion:input.sourceVersion,createdAt:Date.now(),rootDirectory:await realpath(destination),
    manifest:descriptor.manifest,packageDigest:pluginHash(descriptor),dataContract:descriptor.dataContract,valid:true};
}
