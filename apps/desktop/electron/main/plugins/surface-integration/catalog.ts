/**
 * [INPUT]: Validated runtime generations, candidate plugin manifests and the encrypted remote catalog schema.
 * [OUTPUT]: Bounded catalog projection and whole-directory admission with reserved diagnostic bytes and the official Sketch slot.
 * [POS]: Shared projection/admission leaf; native history retains full diagnostics while every admitted catalog can be sealed.
 */
import {canonicalJson} from '@ai-chat/cloud-protocol/encryption';
import {remotePluginCatalogSchema,REMOTE_PLUGIN_CATALOG_LIMITS,type RemotePluginCatalog} from '@ai-chat/cloud-protocol/surfaces/plugin/catalog';
import {isCatalogPlugin} from '../surface-runtime/identity';
import type {PluginGuiManifest} from '../../apps/gui-build/source/manifest';
import type {PluginRuntimeRecord} from '../surface-runtime/model';

const DIAGNOSTIC_BYTES=256;
const encodedBytes=(value:unknown)=>Buffer.byteLength(canonicalJson(value),'utf8');
const diagnosticReserve='x'.repeat(DIAGNOSTIC_BYTES-2);
function diagnostic(error:string|null):string|null{
  if(error===null)return null;
  let summary='';
  for(const character of error){const next=summary+character;if(next.length>500||encodedBytes(next)>DIAGNOSTIC_BYTES)break;summary=next;}
  return summary;
}
export function pluginCatalog(records:readonly PluginRuntimeRecord[],seedError:string):RemotePluginCatalog{
  const entries:RemotePluginCatalog=records.filter(isCatalogPlugin).flatMap(record=>{
    const current=record.generations.find(generation=>generation.generationId===record.activeGenerationId);if(!current)return [];
    return [{id:record.pluginId,name:current.manifest.name,enabled:record.enabled,error:diagnostic(record.error??(current.available?null:'PLUGIN_GENERATION_UNAVAILABLE')),
      generationId:record.activeGenerationId,composer:current.manifest.composer,sourceFormat:current.manifest.sourceFormat}];
  });
  if(!records.some(record=>record.pluginId==='sketch'&&isCatalogPlugin(record)))entries.unshift({id:'sketch',name:'Sketch',enabled:true,error:diagnostic(seedError),generationId:null,
    composer:{id:'sketch',title:'Sketch',icon:'pencil'},sourceFormat:{id:'bottega.sketch',version:1,readableVersions:[1]}});
  return entries;
}
export function admitPluginCatalog(catalog:RemotePluginCatalog,candidate:PluginGuiManifest):void{
  const entries=catalog.filter(entry=>entry.id!==candidate.id);
  entries.push({id:candidate.id,name:candidate.name,enabled:false,error:null,generationId:'plugin-'+'0'.repeat(36),composer:candidate.composer,sourceFormat:candidate.sourceFormat});
  admitCatalogEntries(entries);
}
export function admitCatalogEntries(entries:RemotePluginCatalog):void{
  // Reserve each error's complete encoded budget; false and full generation identities bound later state changes.
  const reserved=entries.map(entry=>({...entry,enabled:false,error:diagnosticReserve,generationId:'plugin-'+'0'.repeat(36)}));
  if(!remotePluginCatalogSchema.safeParse(reserved).success||encodedBytes(reserved)>REMOTE_PLUGIN_CATALOG_LIMITS.plaintextBytes)
    throw new Error(`Plugin catalog capacity exceeded (${REMOTE_PLUGIN_CATALOG_LIMITS.entries} entries or ${REMOTE_PLUGIN_CATALOG_LIMITS.plaintextBytes/1024} KiB). Reduce plugin metadata before installing or activating this version.`);
}
