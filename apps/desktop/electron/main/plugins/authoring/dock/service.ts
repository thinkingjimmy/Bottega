/**
 * [INPUT]: Depends on durable JSON, selected Library identity, main-owned source allocation, Project/source Chat admission and the authored runtime.
 * [OUTPUT]: Provides Library-owned source creation, guarded original Chat restoration, durable same-source continuation pending fork retention roots and pathless definitions.
 * [POS]: Dock authoring owner; no method starts an Agent, applies a generation, grants data or changes Dock layout.
 */
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {realpath} from 'node:fs/promises';
import {z} from 'zod';
import {widgetNameSchema,allocateWidgetName} from '@bottega/contracts/plugins/dock/settings';
import type {WidgetAuthoringTarget,WidgetDefinitionView} from '../../../../../shared/system-dock/widgets/authoring';
import type {ProjectsService} from '../../../projects/projects-service';
import type {ChatStore} from '../../../chats/chat-store';
import type {SourceChatInput} from '../../../chats/lifecycle/source/create';
import type {ChatRecord} from '../../../../../shared/ipc/content/chats-ipc';
import type {PluginSurfaceRuntime} from '../../surface-runtime/service';
import {DurableJson} from '../../../persistence/durable-json';
import {canonicalJson} from '../../../apps/support';
import {createDockSource} from './scaffold';
import {dockForkSeedSchema,createForkSource,type DockForkSeed,type DockForkPackageReader} from './fork';
const operation=z.object({operationId:z.string().min(8).max(128),request:z.string().max(1024),library:z.string().min(1).max(256),id:z.string(),chatId:z.string(),name:widgetNameSchema,projectId:z.string().nullable(),completed:z.boolean(),fork:dockForkSeedSchema.nullable().default(null),
 continuation:z.object({intentId:z.string(),chatId:z.string(),previousChatId:z.string()}).strict().nullable().default(null)}).strict();
const ledger=z.object({version:z.literal(1),operations:z.array(operation).max(128)}).strict();
type Ports={userData:string;libraryId():string|null;projects:ProjectsService;chats:ChatStore;runtime:PluginSurfaceRuntime;createChat?(input:SourceChatInput):Promise<unknown>;readPackage?:DockForkPackageReader;
 restoreChat?(input:{chatId:string;incarnationId:string;projectId:string},current:()=>boolean):Promise<void>};
export class DockAuthoringService{
  private readonly file:DurableJson<z.infer<typeof ledger>>;
  private tail:Promise<unknown>=Promise.resolve();
  private closed=true;
  constructor(private readonly ports:Ports){this.file=new DurableJson(join(ports.userData,'dock-widget-authoring.json'),ledger,()=>({version:1,operations:[]}));}
  async initialize(){await this.file.initialize();this.closed=false;}
  definitions():WidgetDefinitionView[]{
    const library=this.ports.libraryId();if(!library)return[];
    const owned=new Set(this.file.snapshot().operations.filter(entry=>entry.library===library).map(entry=>entry.id));
    return this.ports.runtime.list().flatMap(record=>{
      const manifest=record.authoringManifest??record.generations.find(generation=>generation.generationId===record.activeGenerationId)?.manifest;
      if(!manifest||!('dock' in manifest)||!owned.has(record.pluginId))return[];
      return[{id:record.pluginId,name:manifest.name,description:manifest.summary,chatId:record.ownerChatId,activeGenerationId:record.activeGenerationId,
        candidateGenerationId:record.candidateGenerationId,instanceCount:0,error:record.error}];
    });
  }
  create(input:{operationId:string;name?:string},locale='en'):Promise<WidgetAuthoringTarget>{
    return this.enqueue(()=>this.prepare(input,locale));
  }
  createFork(input:{operationId:string;itemId:string},locale:string,resolve:()=>Promise<{name:string;seed:DockForkSeed}>){
    return this.enqueue(()=>this.prepare({operationId:input.operationId},locale,{request:canonicalJson({forkItemId:input.itemId}),resolve}));
  }
  replacement(id:string){const entry=this.file.snapshot().operations.find(entry=>entry.id===id&&entry.library===this.ports.libraryId());return entry?.fork?{item:entry.fork.target,name:entry.fork.instanceName}:null;}
  private async prepare(input:{operationId:string;name?:string},locale:string,fork?:{request:string;resolve():Promise<{name:string;seed:DockForkSeed}>}):Promise<WidgetAuthoringTarget>{
    const library=this.owner(),request=fork?.request??canonicalJson({name:input.name===undefined?null:widgetNameSchema.parse(input.name)});
    let entry=this.file.snapshot().operations.find(value=>value.operationId===input.operationId);
    if(entry&&entry.library!==library)throw new Error('DOCK_AUTHORING_SCOPE_CHANGED');
    if(entry&&entry.request!==request)throw new Error('DOCK_OPERATION_CONFLICT');
    if(!entry){
      const snapshot=fork?await fork.resolve():null;
      if(this.closed||this.ports.libraryId()!==library)throw new Error('DOCK_AUTHORING_SCOPE_CHANGED');
      const name=allocateWidgetName(snapshot?.name??input.name??'Untitled Widget',this.definitions().map(definition=>definition.name),locale);
      entry={operationId:input.operationId,request,library,id:`plugin-${randomUUID()}`,chatId:`c${randomUUID().replaceAll('-','')}`,name,projectId:null,completed:false,fork:snapshot?dockForkSeedSchema.parse(snapshot.seed):null,continuation:null};
      const created=entry;
      await this.file.mutate(state=>{if(state.operations.length>=128)throw new Error('DOCK_AUTHORING_CAPACITY');state.operations.push(created);});
    }
    if(entry.completed){if(!entry.projectId)throw new Error('DOCK_AUTHORING_RECORD_INVALID');if(entry.continuation)return this.editCurrent(entry.id);return{id:entry.id,chatId:entry.chatId,projectId:entry.projectId};}
    const current=()=>{if(this.closed||this.ports.libraryId()!==library)throw new Error('DOCK_AUTHORING_SCOPE_CHANGED');};current();
    const source=entry.fork?await createForkSource(this.ports.userData,entry.id,entry.name,entry.fork,this.ports.readPackage):await createDockSource(this.ports.userData,entry.id,entry.name);current();
    const {project}=await this.ports.projects.commitExternalProject({canonicalRoot:source,name:entry.name});current();
    if(!this.ports.createChat)throw new Error('DOCK_AUTHORING_UNAVAILABLE');
    await this.ports.createChat({intentId:entry.operationId,id:entry.chatId,pluginId:entry.id,projectId:project.id,title:entry.name});current();
    await this.ports.runtime.registerDockSource(source,entry.chatId);current();
    const id=entry.operationId;await this.file.mutate(state=>{const operation=state.operations.find(value=>value.operationId===id)!;operation.projectId=project.id;operation.completed=true;});
    return{id:entry.id,chatId:entry.chatId,projectId:project.id};
  }
  edit(id:string):Promise<WidgetAuthoringTarget>{return this.enqueue(()=>this.editCurrent(id));}
  private async editCurrent(id:string):Promise<WidgetAuthoringTarget>{
    if(this.closed)throw new Error('DOCK_AUTHORING_CLOSED');
    const library=this.owner();
    const record=this.ports.runtime.descriptor(id);
    if(!record||!this.definitions().some(definition=>definition.id===id))throw new Error('DOCK_WIDGET_NOT_FOUND');
    let entry=this.file.snapshot().operations.find(value=>value.id===id&&value.library===library);if(!entry?.completed||!entry.projectId)throw new Error('DOCK_SOURCE_CHAT_UNAVAILABLE');
    const projectId=entry.projectId,live=()=>!this.closed&&this.ports.libraryId()===library,current=()=>{if(!live())throw new Error('DOCK_AUTHORING_SCOPE_CHANGED');};
    const assertProject=async()=>{try{const workspace=this.ports.projects.resolveCodexContext(projectId).workspace;
      if(await realpath(workspace)!==await realpath(record.sourceRoot))throw new Error('DOCK_SOURCE_PROJECT_CHANGED');}catch{throw new Error('DOCK_SOURCE_PROJECT_CHANGED');}current();};
    await assertProject();
    let chat=await this.ports.chats.getConversation(record.ownerChatId);current();
    if(!entry.continuation&&chat?.projectId===projectId&&!chat.readOnlyReason){
      chat=await this.restoreChat(chat,projectId,live);
      await assertProject();return{id,chatId:chat.id,projectId};
    }
    if(!this.ports.createChat)throw new Error('DOCK_AUTHORING_UNAVAILABLE');
    if(!entry.continuation){
      const continuation={intentId:randomUUID(),chatId:`c${randomUUID().replaceAll('-','')}`,previousChatId:record.ownerChatId};
      await this.file.mutate(state=>{const value=state.operations.find(value=>value.id===id&&value.library===library)!;value.continuation=continuation;});
      entry={...entry,continuation};current();
    }
    const continuation=entry.continuation!;
    await this.ports.createChat({intentId:continuation.intentId,id:continuation.chatId,pluginId:id,projectId,title:entry.name});current();await assertProject();
    const continued=await this.ports.chats.getConversation(continuation.chatId);current();
    if(!continued||continued.projectId!==projectId||continued.readOnlyReason)throw new Error('DOCK_SOURCE_CHAT_UNAVAILABLE');await this.restoreChat(continued,projectId,live);current();
    const owner=this.ports.runtime.descriptor(id)?.ownerChatId;
    if(owner===continuation.previousChatId)await this.ports.runtime.bindAuthoringChat(id,continuation.chatId,continuation.previousChatId);
    else if(owner!==continuation.chatId)throw new Error('DOCK_SOURCE_CHAT_CHANGED');current();
    await this.file.mutate(state=>{const value=state.operations.find(value=>value.id===id&&value.library===library)!;if(value.continuation?.intentId!==continuation.intentId)throw new Error('DOCK_SOURCE_CHAT_CHANGED');value.chatId=continuation.chatId;value.continuation=null;});
    return{id,chatId:continuation.chatId,projectId};
  }
  private async restoreChat(chat:ChatRecord,projectId:string,current:()=>boolean):Promise<ChatRecord>{
    if(!current())throw new Error('DOCK_AUTHORING_SCOPE_CHANGED');if(!chat.archivedAt)return chat;
    if(!this.ports.restoreChat)throw new Error('DOCK_SOURCE_CHAT_ARCHIVED');const incarnation=chat.incarnationId;
    await this.ports.restoreChat({chatId:chat.id,incarnationId:incarnation,projectId},current);
    if(!current())throw new Error('DOCK_AUTHORING_SCOPE_CHANGED');const restored=await this.ports.chats.getConversation(chat.id);
    if(!current())throw new Error('DOCK_AUTHORING_SCOPE_CHANGED');
    if(!restored||restored.incarnationId!==incarnation||restored.projectId!==projectId||restored.archivedAt||restored.readOnlyReason)throw new Error('DOCK_SOURCE_CHAT_UNAVAILABLE');return restored;
  }
  build(id:string){return this.enqueue(async()=>{const library=this.owner();await this.editCurrent(id);await this.ports.runtime.rebuild(id);if(this.closed||this.ports.libraryId()!==library)throw new Error('DOCK_AUTHORING_SCOPE_CHANGED');return this.ports.runtime.dockPreview(id);});}
  preview(id:string){return this.enqueue(async()=>{const library=this.owner();if(!this.definitions().some(value=>value.id===id))throw new Error('DOCK_WIDGET_NOT_FOUND');const preview=await this.ports.runtime.dockPreview(id);if(this.closed||this.ports.libraryId()!==library)throw new Error('DOCK_AUTHORING_SCOPE_CHANGED');return preview;});}
  private owner(){const library=this.ports.libraryId();if(!library)throw new Error('DOCK_AUTHORING_LIBRARY_UNAVAILABLE');return library;}
  private enqueue<T>(run:()=>Promise<T>):Promise<T>{if(this.closed)return Promise.reject(new Error('DOCK_AUTHORING_CLOSED'));const next=this.tail.then(run);this.tail=next.catch(()=>{});return next;}
  retainedReferences(){return this.file.read(state=>state.operations.flatMap(value=>!value.completed&&value.fork?.source.kind==='package'?[value.fork.source.reference]:[]));}
  async close(){this.closed=true;await this.tail;await this.file.closeAndFlush();}
}
