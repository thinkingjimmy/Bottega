/**
 * [INPUT]: Shared reserved product identities and the host-owned canonical official source authority.
 * [OUTPUT]: assertPluginIdentity validates durable provenance; isCatalogPlugin excludes conflicting records from projections.
 * [POS]: Identity admission shared by runtime loading, mutation and delivery; source manifests cannot confer official ownership.
 */
import {isReservedPluginId} from '@bottega/contracts/plugins/descriptor';
import type {PluginRuntimeOptions,PluginRuntimeRecord} from './model';

export async function assertPluginIdentity(record:Pick<PluginRuntimeRecord,'pluginId'|'origin'|'sourceRoot'>,options:PluginRuntimeOptions):Promise<void>{
 if(record.origin==='official'){
  if(record.pluginId!=='sketch'||!options.officialSourceRoot||record.sourceRoot!==await options.officialSourceRoot())
   throw new Error('Official plugin identity requires its trusted source');
 }else if(isReservedPluginId(record.pluginId))throw new Error('Plugin identity is reserved by Bottega');
}
export function isCatalogPlugin(record:Pick<PluginRuntimeRecord,'pluginId'|'origin'>):boolean{
 return !isReservedPluginId(record.pluginId)||(record.pluginId==='sketch'&&record.origin==='official');
}
