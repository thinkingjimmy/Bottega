/**
 * [INPUT]: Depends on strict Dock snapshots, verified immutable packages and canonical editable source allocation.
 * [OUTPUT]: Provides bounded durable fork seeds and independent source materialization without copied authority.
 * [POS]: Dock authoring seed boundary; original instances and official product files stay unchanged until application.
 */
import {z} from 'zod';
import {dockContributionSchema} from '@bottega/contracts/plugins/dock/manifest';
import {widgetNameSchema} from '@bottega/contracts/plugins/dock/settings';
import {dockWidgetItemSchema} from '../../../../../shared/system-dock/layout';
import type {WidgetPackageStore} from '../../surface-runtime/packages/store';
import {dockPluginManifestSchema} from '../../../apps/gui-build/source/manifest';
import {createDockSource,writeDockSource} from './scaffold';
export const dockForkSeedSchema=z.object({target:dockWidgetItemSchema,instanceName:widgetNameSchema,
 source:z.discriminatedUnion('kind',[
  z.object({kind:z.literal('official'),revision:z.literal(1),dock:dockContributionSchema}).strict(),
  z.object({kind:z.literal('package'),reference:z.string().regex(/^sha256:[a-f0-9]{64}$/)}).strict(),
 ])}).strict();
export type DockForkSeed=z.infer<typeof dockForkSeedSchema>;
export type DockForkPackageReader=(reference:string)=>ReturnType<WidgetPackageStore['read']>;
export async function createForkSource(userData:string,id:string,name:string,seed:DockForkSeed,readPackage?:DockForkPackageReader){
 if(seed.source.kind==='official')return createDockSource(userData,id,name,seed.source.dock);
 if(!readPackage||seed.target.widget.type!=='custom')throw new Error('DOCK_FORK_SOURCE_UNAVAILABLE');
 const packet=await readPackage(seed.source.reference),expected=seed.target.widget.definition,actual=packet.descriptor;
 if(seed.source.reference!==expected.packageRef||actual.source.installationId!==expected.sourceInstallationId||actual.source.definitionId!==expected.definitionId||actual.source.generationId!==expected.generationId||actual.contractDigest!==expected.contractDigest)throw new Error('DOCK_FORK_SOURCE_CHANGED');
 const files:Record<string,Buffer>={};for(const file of packet.files)if(file.path.startsWith('source/'))files[file.path.slice(7)]=Buffer.from(file.content,'base64');
 const raw=JSON.parse(files['plugin.json']?.toString('utf8')??'null');if(!raw)throw new Error('DOCK_FORK_SOURCE_UNAVAILABLE');
 raw.id=id;raw.name=name;raw.version='1.0.0';
 for(const field of raw.dock.settings)if(Object.hasOwn(seed.target.widget.settings,field.id))field.default=seed.target.widget.settings[field.id];
 files['plugin.json']=Buffer.from(JSON.stringify(dockPluginManifestSchema.parse(raw),null,2)+'\n');
 return writeDockSource(userData,id,files);
}
