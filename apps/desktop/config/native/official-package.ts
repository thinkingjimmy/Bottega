/**
 * [INPUT]: Production plugin source, the existing compiler and immutable distribution contracts.
 * [OUTPUT]: Build-time official weather assets with complete source and verified byte identities.
 * [POS]: Official package assembler, bundled by the Vite adapter before evaluation.
 */
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {unifiedPluginManifestSchema,unifiedPluginDistributionSchema,unifiedPluginRevisionId} from '@bottega/contracts/plugins/platform';
import {compileUnifiedPlugin} from '../../electron/main/plugins/engineering/compiler/kernel';
import {inventoryPluginTree,pluginHash,pluginBytesHash} from '../../electron/main/plugins/engineering/snapshot';
export async function buildOfficialWeather(desktop:string,watch:(path:string)=>void,emit:(path:string,bytes:Buffer)=>void){
  if(process.platform!=='darwin')return;
  const source=resolve(desktop,'resources/plugins/weather'),stage=await mkdtemp(join(tmpdir(),'bottega-official-build-'));
  try{
   const manifest=unifiedPluginManifestSchema.parse(JSON.parse(await readFile(join(source,'bottega.plugin.json'),'utf8')));
   for(const file of await inventoryPluginTree(source))watch(join(source,file.path));
   const compiled=await compileUnifiedPlugin({sourceRoot:source,outputRoot:stage,manifest});
   await mkdir(join(stage,'source'),{recursive:true});
   for(const file of await inventoryPluginTree(source)){
    if(file.path==='README.md')continue;
    const text=(await readFile(join(source,file.path),'utf8')).replace(/\/\*\*[\s\S]*?\[PROTOCOL\][\s\S]*?\*\/\s*/g,'');
    await writeFile(join(stage,'source',file.path),text);
   }
   await writeFile(join(stage,'bottega.plugin.json'),JSON.stringify(compiled.manifest)+'\n');
   const files=(await inventoryPluginTree(stage)).map(file=>({...file,role:file.path.startsWith('source/')?'source' as const:file.path.startsWith('runtime/')?'runtime' as const:'metadata' as const}));
   const sources=files.filter(file=>file.role==='source').map(({path,bytes,sha256})=>({path:path.slice(7),bytes,sha256}));
   const identity={pluginId:manifest.id,sourceDigest:pluginHash(sources),manifestDigest:pluginHash(compiled.manifest),lockDigest:pluginBytesHash(Buffer.alloc(0)),dependencyDigest:pluginHash([]),toolchainDigest:pluginHash({compiler:'official-weather/v1',node:24}),contentDigest:pluginHash(files),target:{platform:'darwin' as const,arch:process.arch as 'arm64'|'x64',nodeMajor:24,sdkVersion:1 as const},dataContract:manifest.dataContract};
   const descriptor=unifiedPluginDistributionSchema.parse({format:'bottega-plugin/v1',schemaVersion:1,...identity,revisionId:unifiedPluginRevisionId(identity),manifest:compiled.manifest,files});
   await writeFile(join(stage,'plugin-package.json'),JSON.stringify(descriptor)+'\n');
   for(const file of await inventoryPluginTree(stage))emit('official-plugins/weather/'+file.path,await readFile(join(stage,file.path)));
  }finally{await rm(stage,{recursive:true,force:true});}
}
