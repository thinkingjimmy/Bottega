/**
 * [INPUT]: Depends on held source previews, immutable package verification, registered Main windows and current device/data scope.
 * [OUTPUT]: Provides createDockWidgetPreviews with scoped publication, window/lock observation and temporary runtime factories with the shared API broker.
 * [POS]: Main feature adapter; no account, window identity, source path or data authority comes from author code.
 */
import {powerMonitor,type BrowserWindow} from 'electron';
import {hostname} from 'node:os';
import {dockPluginManifestSchema} from '../../../apps/gui-build/source/manifest';
import {verifyPackage} from '../../../plugins/surface-runtime/packages/codec';
import {windowRegistry} from '../../../window/surfaces/window-registry';
import {SYSTEM_DOCK_SETTINGS_CHANNEL as CHANNEL} from '../../../../../shared/ipc-channels/window';
import {DockWidgetPreviews} from './owner';
import {createWidgetPreviewRuntime} from './runtime';
import type {DockWidgetApplications} from '../../store/custom/applications';
import type {WidgetPackageStore} from '../../../plugins/surface-runtime/packages/store';
import type {PluginSurfaceGateway} from '../../../plugins/surface-runtime/gateway';
import type {LocalWidgetScope} from '../../store/custom/model';
import type {DockApiData} from '../api/owner';
import type {SystemDockRuntimePorts} from '../../composition';
type Ports={applications:DockWidgetApplications;packages:WidgetPackageStore;api?:DockApiData;runtime:SystemDockRuntimePorts;gateway:PluginSurfaceGateway;scope():LocalWidgetScope;masked():boolean;account(backend:string):string|null;onAccounts(listener:()=>void):()=>void;label(key:string):string};
export function createDockWidgetPreviews(ports:Ports){
 let locked=false;
 const previews=new DockWidgetPreviews({
  async prepare(previewId,chatId){const context=ports.applications.previewContext(previewId);if(context.chatId!==chatId)throw new Error('DOCK_PREVIEW_SCOPE_CHANGED');
   const frozen=await ports.packages.prepare(context.preview.id,context.preview.generationId);if(frozen.reference!==context.preview.packageRef)throw new Error('DOCK_PREVIEW_CONFLICT');
   const packet=verifyPackage(frozen.bytes,frozen.reference,{accountId:context.scope.accountId,installationId:context.preview.executionInstallationId,definitionId:context.preview.id,generationId:context.preview.generationId}),entry=packet.files.find(file=>file.path==='runtime/plugin.json');if(!entry)throw new Error('WIDGET_PACKAGE_MANIFEST_MISSING');
   const manifest=dockPluginManifestSchema.parse(JSON.parse(Buffer.from(entry.content,'base64').toString('utf8')));ports.applications.previewContext(previewId);return{...context,manifest,packet};},
  draft:(id,chat,target)=>ports.applications.previewDraft(id,chat,target),current(prepared){try{const next=ports.applications.previewContext(prepared.preview.previewId);return next.chatId===prepared.chatId;}catch{return false;}},
  window(id){const record=windowRegistry.fromWebContents(id);return record?.role==='main'?record.window as BrowserWindow:null;},
  watch(window,changed){locked=powerMonitor.getSystemIdleState(1)==='locked';const lock=()=>{locked=true;changed();},unlock=()=>{locked=false;changed();};window.on('hide',changed);window.on('show',changed);window.on('minimize',changed);window.on('restore',changed);window.on('closed',changed);powerMonitor.on('lock-screen',lock);powerMonitor.on('suspend',lock);powerMonitor.on('unlock-screen',unlock);powerMonitor.on('resume',unlock);
   return()=>{window.removeListener('hide',changed);window.removeListener('show',changed);window.removeListener('minimize',changed);window.removeListener('restore',changed);window.removeListener('closed',changed);powerMonitor.removeListener('lock-screen',lock);powerMonitor.removeListener('suspend',lock);powerMonitor.removeListener('unlock-screen',unlock);powerMonitor.removeListener('resume',unlock);};},
  masked:ports.masked,locked:()=>locked||powerMonitor.getSystemIdleState(1)==='locked',computerName:hostname,
  createRuntime:(session,current,changed)=>createWidgetPreviewRuntime(session,current,changed,{...ports,demonstrate:async ref=>{await previews.command(session.windowId,{kind:'action',sessionId:session.id,ref});},finish:()=>{void previews.command(session.windowId,{kind:'close',sessionId:session.id}).catch(error=>console.warn('[system-dock] Preview close failed',error));}}),
  publish(id,snapshot){const record=windowRegistry.fromWebContents(id);if(record?.role==='main')record.window.webContents.send(CHANNEL.widgetPreviewChanged,snapshot);},
 });return previews;
}
