/**
 * [INPUT]: Depends only on schema-free Dock operation types and clone-safe primitives.
 * [OUTPUT]: Provides dedicated native detail channels, launch identity, slot/presentation DTOs and main-only health counts.
 * [POS]: Zod-free native Widget transport; it carries no product bridge, filesystem path or caller-selected authority.
 */
import type {DockOperation} from '@bottega/contracts/plugins/dock/session/protocol';
import type {WidgetPreviewHealth} from './preview/contracts';
export const DOCK_DETAIL_CHANNEL={request:'dock-widget-detail:request',changed:'dock-widget-detail:changed',gesture:'dock-widget-detail:gesture',escape:'dock-widget-detail:escape',fault:'dock-widget-detail:fault'}as const;
export const DOCK_DETAIL_ARGUMENT='--dock-widget-session=';
export type DockDetailChange=Readonly<{kind:'data'}|{kind:'preferences';locale:string;theme:'light'|'dark'}>;
export type DockDetailBridge={request(operation:DockOperation,payload?:unknown):Promise<unknown>;onChanged(listener:(change:DockDetailChange)=>void):()=>void;fail():void};
export type DockDetailSlot=Readonly<{itemId:string;key:string;bounds:Readonly<{x:number;y:number;width:number;height:number}>}>;
export type DockDetailPresentation=Readonly<{key:string;state:'available'|'loading'|'ready'|'failed'}>;
export type WidgetRuntimeHealth=Readonly<{detail:Readonly<{views:number;sessions:number;timers:number;requests:number}>;base?:Readonly<{consumers:number;flights:number;timers:number}>;api?:Readonly<{consumers:number;flights:number;queued:number;timers:number;entries:number}>;preview?:WidgetPreviewHealth;feature?:Readonly<{loaded:boolean;loading:boolean;sourceLoaded:boolean}>}>;
