/**
 * [INPUT]: Depends on public Dock data/settings contracts and portable Base bindings.
 * [OUTPUT]: Provides Main-only Base refresh plans, bounded page/read ports and measured results.
 * [POS]: Pure Base Widget seam; selected bindings are validated separately by the local permission owner.
 */
import type {DockDataRequirement,DockReading} from '@bottega/contracts/plugins/dock/data';
import type {DockSettings} from '@bottega/contracts/plugins/dock/settings';
import type {DockBaseBinding} from '../../../../../shared/system-dock/widgets/instance';
import type {DockContribution} from '@bottega/contracts/plugins/dock/manifest';
import type {CustomDockWidget} from '../../../../../shared/system-dock/widgets/instance';
import type {WidgetBaseDirectory,WidgetBaseDirectoryRequest} from '../../../../../shared/system-dock/widgets/base/access';
import type {WidgetDetailSource} from '../detail/ports';
import type {DockSurface} from '../usage';
import type {BasesService} from '../../../bases/bases-service';
export type BaseWidgetQuery=Extract<DockDataRequirement,{kind:'base'}>;
export type DockBasePlan=Readonly<{bindings:readonly DockBaseBinding[];queries:readonly BaseWidgetQuery[];settings:DockSettings}>;
export type DockBasePage=Readonly<{revision:number;ownerInstanceId:string;columns:readonly Readonly<{id:string;name?:string;type:string}>[];
 rows:readonly Readonly<{id:string;values:Readonly<Record<string,unknown>>}>[];hasMore:boolean}>;
export type DockBasePageReader=(binding:DockBaseBinding,offset:number,limit:number,signal:AbortSignal)=>Promise<DockBasePage>;
export type DockBaseReadResult=Readonly<{readings:Readonly<Record<string,DockReading>>;metrics:Readonly<{scanned:number;pages:number;elapsedMs:number}>}>;
export type DockBaseHealth=Readonly<{consumers:number;flights:number;timers:number}>;
export type DockBaseDataPorts={bases:Pick<BasesService,'get'|'store'|'onBaseEvent'>;source(itemId:string):WidgetDetailSource|null;changed():void};
export interface DockBaseDataPort{
 setVisible(surface:DockSurface,sources:readonly WidgetDetailSource[]):void;
 reading(itemId:string,sourceId:string):DockReading;
 identity(source:WidgetDetailSource):string;
 validate(dock:DockContribution,widget:CustomDockWidget):Promise<void>;
 directory(input:WidgetBaseDirectoryRequest):Promise<WidgetBaseDirectory>;
 refresh(itemId:string):Promise<void>;
 health():DockBaseHealth;
 close():Promise<void>;
}
