/**
 * [INPUT]: Depends on verified packages, held application previews, local accepted schemas and existing native detail/data DTOs.
 * [OUTPUT]: Provides PreparedWidgetPreview, WidgetPreviewSession, WidgetPreviewRuntime and WidgetPreviewPorts.
 * [POS]: Main-only temporary execution seam; source Chat owns stable draft configuration; each preview has a separate temporary runtime permit.
 */
import type {BrowserWindow} from 'electron';
import type {WidgetPreview} from '../../../../../shared/system-dock/widgets/authoring';
import type {WidgetPreviewConfiguration,WidgetPreviewSnapshot} from '../../../../../shared/system-dock/widgets/preview/contracts';
import type {CustomWidgetDetail} from '../../../../../shared/system-dock/widgets/runtime';
import type {DockDetailSlot,WidgetRuntimeHealth} from '../../../../../shared/system-dock/widgets/native';
import type {AcceptedWidget,CustomWidgetItem,LocalWidgetScope} from '../../store/custom/model';
import type {DockPluginManifest} from '../../../apps/gui-build/source/manifest';
import type {WidgetPackageStore} from '../../../plugins/surface-runtime/packages/store';
export type PreparedWidgetPreview={preview:WidgetPreview;scope:LocalWidgetScope;chatId:string;manifest:DockPluginManifest;packet:Awaited<ReturnType<WidgetPackageStore['read']>>;expiresAt:number};
export type WidgetPreviewSession={id:string;requestId:string;windowId:number;window:BrowserWindow;prepared:PreparedWidgetPreview;mode:'sample'|'real';theme:'light'|'dark';apiConsent:readonly string[];apiTargetId?:string;item:CustomWidgetItem;accepted:AcceptedWidget};
export type WidgetPreviewRuntime={setVisible(visible:boolean):void;snapshot():CustomWidgetDetail;bounds(slot:DockDetailSlot|null):void;retry(key:string):void;refresh():Promise<void>;health():WidgetRuntimeHealth;close():Promise<void>};
export type WidgetPreviewPorts={
 prepare(previewId:string,chatId:string):Promise<PreparedWidgetPreview>;
 draft(previewId:string,chatId:string,targetId?:string):Promise<WidgetPreviewConfiguration>;
 current(prepared:PreparedWidgetPreview):boolean;
 window(webContentsId:number):BrowserWindow|null;
 watch(window:BrowserWindow,changed:()=>void):()=>void;
 masked():boolean;locked():boolean;computerName():string;now?():number;
 schedule?(milliseconds:number,expired:()=>void):()=>void;
 createRuntime(session:WidgetPreviewSession,current:()=>boolean,changed:()=>void):Promise<WidgetPreviewRuntime>;
 publish(webContentsId:number,snapshot:WidgetPreviewSnapshot):void;
};
