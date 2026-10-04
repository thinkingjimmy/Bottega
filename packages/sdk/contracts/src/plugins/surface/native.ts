/**
 * [INPUT]: Opaque source envelopes and declared plugin Surface operations.
 * [OUTPUT]: Native plugin Surface descriptors, window-bound lease validation, generation history and trusted product-window bridge contracts.
 * [POS]: Trusted renderer-to-main boundary; plugin frames receive only their session RPC capability.
 */
import type { PluginSource } from './source';
import type { PluginSurfaceOperation } from './contract';
export type PluginSourceFormat = Readonly<{ id:string; version:number; readableVersions:readonly number[] }>;
export type PluginDraftOwner = Readonly<{ chatId:string; incarnationId:string }>;
export type PluginRecoveryScope = PluginDraftOwner & Readonly<{ pluginId:string; ownerDeviceId?:string; attachmentId?:string }>;
export type PluginComposerEntry = Readonly<{ id:string; name:string; icon:string; enabled:boolean; reason?:string;
  activeGenerationId:string|null; sourceFormat:PluginSourceFormat; operations:readonly PluginSurfaceOperation[] }>;
export type PluginSurfaceDescriptor = Readonly<{ id:string; pluginId:string; generationId:string; url:string; origin:string;
  expiresAt:number; readyNonce:string; sourceFormat:PluginSourceFormat; operations:readonly PluginSurfaceOperation[]; sandbox:'allow-scripts' }>;
export type GuiGeneration = Readonly<{ generationId:string; createdAt:number; active:boolean; previous:boolean; available:boolean; version:string }>;
export type GuiHistory = Readonly<{ activeGenerationId:string|null; pendingGenerationId?:string|null; generations:readonly GuiGeneration[]; error:string|null }>;
export interface PluginSurfacesBridge {
  list():Promise<readonly PluginComposerEntry[]>;
  open(pluginId:string,owner:PluginDraftOwner):Promise<PluginSurfaceDescriptor>;
  openRemote(pluginId:string,ownerDeviceId:string,owner:PluginDraftOwner):Promise<PluginSurfaceDescriptor>;
  validate(id:string):Promise<boolean>;
  release(id:string):Promise<void>;
  onChanged(listener:()=>void):()=>void;
  history(pluginId:string):Promise<GuiHistory>;
  activate(pluginId:string,generationId:string,expectedActiveGenerationId:string):Promise<void>;
  newPlugin(draftChatId:string):Promise<{chatId:string;projectId:string}>;
  edit(pluginId:string,draftChatId:string|null):Promise<{chatId:string;projectId?:string}|null>;
  installLocal(draftChatId:string):Promise<{chatId:string}|null>;
  recovery:{read(scope:PluginRecoveryScope):Promise<PluginSource|null>;write(scope:PluginRecoveryScope,source:PluginSource):Promise<void>;remove(scope:PluginRecoveryScope):Promise<void>};
}
export const PLUGIN_SURFACES_CHANNEL = Object.freeze({list:'plugin-surfaces:list',openRemote:'plugin-surfaces:open-remote',open:'plugin-surfaces:open',validate:'plugin-surfaces:validate',release:'plugin-surfaces:release',
 changed:'plugin-surfaces:changed',history:'plugin-surfaces:history',activate:'plugin-surfaces:activate',newPlugin:'plugin-surfaces:new',edit:'plugin-surfaces:edit',installLocal:'plugin-surfaces:install-local',
 recoveryRead:'plugin-surfaces:recovery-read',recoveryWrite:'plugin-surfaces:recovery-write',recoveryRemove:'plugin-surfaces:recovery-remove'} as const);
export type GuiOwner=Readonly<{kind:'app'|'plugin';id:string}>;
export interface GuiGenerationsBridge { history(owner:GuiOwner):Promise<GuiHistory>;activate(owner:GuiOwner,generationId:string,expected:string):Promise<void> }
export const GUI_GENERATIONS_CHANNEL=Object.freeze({history:'gui-generations:history',activate:'gui-generations:activate'} as const);
