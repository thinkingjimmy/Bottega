/**
 * [INPUT]: Trusted renderer IPC, resident Chat authority, plugin integration, App lifecycle and a native folder picker.
 * [OUTPUT]: Current-draft leases/recovery, trusted-window lease validation, main-only official initialization retry, source Chat selection and common App/plugin generation commands.
 * [POS]: UI authority adapter; sandbox frames cannot invoke these channels or choose filesystem paths.
 */
import { dialog, type BrowserWindow } from 'electron';
import { z } from 'zod';
import { PLUGIN_SURFACES_CHANNEL as C, GUI_GENERATIONS_CHANNEL as G } from '@bottega/contracts/plugins/surface/native';
import { pluginSourceSchema } from '@bottega/contracts/plugins/surface/source';
import type { AppsService } from '../../apps/apps-service';
import { rendererIpc } from "../../registration/ipc-registrar";
import { surfaceWindowController } from '../../window/surfaces/surface-window-controller';
import { windowRegistry } from '../../window/surfaces/window-registry';
import type { TrustedRendererContext } from '../../window/surfaces/trusted-renderer-context';
import type { PluginSurfaceIntegration } from './service';
const id=z.string().min(1).max(160),draft=z.object({chatId:id,incarnationId:z.string().max(128)}).strict();
const recovery=draft.extend({pluginId:id,ownerDeviceId:id.optional(),attachmentId:id.optional()}).strict(),owner=z.object({kind:z.enum(['app','plugin']),id}).strict();
export function registerPluginSurfaces(service:PluginSurfaceIntegration,apps:AppsService,window:BrowserWindow,rendererUrl:string){
  const webContentsId=window.webContents.id;
  const assertDraft=(context:TrustedRendererContext,value:z.infer<typeof draft>)=>{
    surfaceWindowController.assertConversationMutation(context,value.chatId);
    service.assertOwner(value);
  };
  const assertRecovery=(context:TrustedRendererContext,raw:unknown)=>{
    const value=recovery.parse(raw);
    if(context.role==='app-window'){
      if(value.ownerDeviceId)throw new Error('PLUGIN_REMOTE_SCOPE_DENIED');
      assertDraft(context,value);
    }else if(!value.ownerDeviceId)assertDraft(context,value);
    return value;
  };
  const assertHistory=(context:TrustedRendererContext,raw:unknown)=>{
    const value=owner.parse(raw);
    if(context.role==='app-window'){
      if(value.kind!=='app'||value.id!==context.appId)throw new Error('PLUGIN_HISTORY_SCOPE_DENIED');
      surfaceWindowController.assertAppStudioMutation(context,value.id);
    }
    return value;
  };
  const scope=rendererIpc(rendererUrl,'Plugin control is unavailable to this window').roles('main','app-window');
  scope.handle(C.list,()=>service.list())
    .handleWithContext(C.open,async(context,plugin,raw)=>{const value=draft.parse(raw);assertDraft(context,value);return service.gateway.issue(id.parse(plugin),context.webContentsId);})
    .handleWithContext(C.validate,async(context,lease)=>{const leaseId=id.parse(lease);try{await service.gateway.validate(leaseId,context.webContentsId);return true;}catch{return false;}})
    .handleWithContext(C.release,(context,lease)=>service.remote.release(id.parse(lease),context.webContentsId))
    .handleWithContext(C.recoveryRead,(context,raw)=>service.recovery.read(assertRecovery(context,raw)))
    .handleWithContext(C.recoveryWrite,(context,raw,source)=>service.recovery.write(assertRecovery(context,raw),pluginSourceSchema.parse(source)))
    .handleWithContext(C.recoveryRemove,(context,raw)=>service.recovery.remove(assertRecovery(context,raw)))
    .roles('main')
    .handleWithContext(C.openRemote,(context,plugin,device,raw)=>service.remote.open(id.parse(plugin),id.parse(device),draft.parse(raw),context.webContentsId))
    .handle(C.history,plugin=>service.history(id.parse(plugin)))
    .handle(C.retryInitialization,plugin=>service.retryInitialization(id.parse(plugin)))
    .handle(C.activate,async(plugin,generation,expected)=>{await service.runtime.activate(id.parse(plugin),id.parse(generation),{expectedActiveGenerationId:id.parse(expected)});})
    .handle(C.edit,(plugin,chat)=>service.edit(id.parse(plugin),id.nullable().parse(chat)))
    .handle(C.newPlugin,chat=>service.newPlugin(id.parse(chat)))
    .handle(C.installLocal,async chat=>{
      const chatId=id.parse(chat);service.assertOwner({chatId,incarnationId:''});
      const selected=await dialog.showOpenDialog(window,{properties:['openDirectory']});
      if(selected.canceled||selected.filePaths.length!==1)return null;
      service.assertOwner({chatId,incarnationId:''});
      await service.runtime.installLocal(selected.filePaths[0]!,{ownerChatId:chatId});return {chatId};
    })
    .roles('main','app-window')
    .handleWithContext(G.history,async(context,raw)=>{
      const value=assertHistory(context,raw);if(value.kind==='plugin')return service.history(value.id);
      const generations=await apps.store.generationHistory(value.id),active=generations.find(generation=>generation.active);
      const previous=generations.filter(generation=>!generation.active&&generation.available).sort((a,b)=>b.createdAt-a.createdAt)[0];
      return {activeGenerationId:active?.generationId??null,pendingGenerationId:apps.store.get(value.id)?.generationBinding.pending?.generationId??null,error:null,generations:generations.map(generation=>({...generation,version:'',previous:generation.generationId===previous?.generationId}))};
    })
    .handleWithContext(G.activate,async(context,raw,generation,expected)=>{
      const value=assertHistory(context,raw),target=id.parse(generation),current=id.parse(expected);
      if(value.kind==='plugin')await service.runtime.activate(value.id,target,{expectedActiveGenerationId:current});
      else await apps.store.restoreGeneration(value.id,target,current);
    });
  const release=service.onChanged(()=>{windowRegistry.publish(C.changed,undefined);});
  const releaseWindows=windowRegistry.subscribe(event=>{
    if(event.type==='closed'||event.type==='renderer-gone')service.remote.releaseWindow(event.record.webContentsId);
  });
  window.once('closed',()=>{release();releaseWindows();service.remote.releaseWindow(webContentsId);});
}
