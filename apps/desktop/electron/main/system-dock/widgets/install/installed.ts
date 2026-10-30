/**
 * [INPUT]: Depends on exact local package confirmations, current local scope, verified immutable archives and public default settings.
 * [OUTPUT]: Provides installedWidgetDefinitions and savedInstalledWidget with readable verified names and fresh independent configuration, without source Project/Chat identity or data grants.
 * [POS]: Main receiver metadata/cached-instance leaf; installation confirmation does not create an authoring source or copy a running instance.
 */
import {canonicalJson,hashCanonical} from '@bottega/contracts/core/canonical-json';
import {defaultDockSettings} from '@bottega/contracts/plugins/dock/settings';
import type {WidgetInstalledDefinition} from '../../../../../shared/system-dock/widgets/install/types';
import type {CustomDockWidget} from '../../../../../shared/system-dock/widgets/instance';
import type {LocalWidgetScope,CustomWidgetItem} from '../../store/custom/model';
import type {WidgetPackageStore} from '../../../plugins/surface-runtime/packages/store';
import {dockPluginManifestSchema} from '../../../apps/gui-build/source/manifest';
import type {InstallationRecord} from './model';
type Subject={definitionId:string;sourceInstallationId:string};
export function installedWidgetDefinitions(records:readonly InstallationRecord[],scope:LocalWidgetScope,items:readonly CustomWidgetItem[]):WidgetInstalledDefinition[]{
 const selected=new Map<string,InstallationRecord>();for(const value of records){if(canonicalJson(value.scope)!==canonicalJson(scope)||value.subject.sourceInstallationId===scope.installationId)continue;const key=hashCanonical(value.subject),previous=selected.get(key);if(!previous||previous.confirmedAt<=value.confirmedAt)selected.set(key,value);}
 return[...selected].map(([key,value])=>({key:'installed-'+key,definitionId:value.subject.definitionId,sourceInstallationId:value.subject.sourceInstallationId,name:value.name,reference:value.reference,instanceCount:items.filter(item=>item.widget.definition.definitionId===value.subject.definitionId&&item.widget.definition.sourceInstallationId===value.subject.sourceInstallationId).length}));
}
export async function savedInstalledWidget(records:readonly InstallationRecord[],scope:LocalWidgetScope,subject:Subject,packages:WidgetPackageStore,current:()=>void){
 const confirmation=records.filter(value=>canonicalJson(value.scope)===canonicalJson(scope)&&canonicalJson(value.subject)===canonicalJson(subject)).sort((a,b)=>b.confirmedAt-a.confirmedAt)[0];if(!confirmation)throw new Error('WIDGET_INSTALL_CONFIRMATION_REQUIRED');
 const packet=await packages.read(confirmation.reference);current();const source=packet.descriptor.source,entry=packet.files.find(value=>value.path==='runtime/plugin.json');
 if(!entry||source.accountId!==scope.accountId||source.definitionId!==subject.definitionId||source.installationId!==subject.sourceInstallationId||source.generationId!==confirmation.generationId||packet.descriptor.contractDigest!==confirmation.contractDigest)throw new Error('WIDGET_PACKAGE_SOURCE_CHANGED');
 const manifest=dockPluginManifestSchema.parse(JSON.parse(Buffer.from(entry.content,'base64').toString('utf8'))),widget:CustomDockWidget={type:'custom',configVersion:1,size:manifest.dock.sizes[0]!,definition:{...subject,generationId:source.generationId,packageRef:confirmation.reference,contractDigest:confirmation.contractDigest},settings:defaultDockSettings(manifest.dock.settings),bindings:[]};
 return{name:manifest.name,dock:manifest.dock,widget};
}
