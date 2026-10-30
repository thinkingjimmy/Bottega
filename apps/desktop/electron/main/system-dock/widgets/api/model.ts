/**
 * [INPUT]: Depends on public API declarations, trusted Widget sources and typed Dock readings.
 * [OUTPUT]: Provides Main-only API consumer, connection review and journal association seams.
 * [POS]: Broker composition contract; renderer inputs never choose a credential owner or supply HTTP bytes.
 */
import type {DockApiFailure,DockApiRequirement} from '@bottega/contracts/plugins/dock/api';
import type {DockReading} from '@bottega/contracts/plugins/dock/data';
import type {DockContribution} from '@bottega/contracts/plugins/dock/manifest';
import type {CustomDockWidget} from '../../../../../shared/system-dock/widgets/instance';
import type {WidgetDetailSource} from '../detail/ports';
import type {ApiOwner} from './state/model';
export type {ApiOwner} from './state/model';
export type ApiReading=DockReading&Readonly<{failure?:DockApiFailure}>;
export type ApiHealth=Readonly<{consumers:number;flights:number;queued:number;timers:number;entries:number}>;
export type ApiConsumerPorts=Readonly<{source(itemId:string):WidgetDetailSource|null;changed():void;owner?(source:WidgetDetailSource):ApiOwner;credentialOwner?(source:WidgetDetailSource):ApiOwner;current?(source:WidgetDetailSource):boolean}>;
export type ApiConnectionReview=Readonly<{
 requests:readonly Readonly<{id:string;purpose:string;method:'GET'|'HEAD'|'POST';origin:string;path:string;parameters:Readonly<Record<string,string|number|boolean>>;
  authorized:boolean;configured:boolean;slot:string|null;authentication:'none'|'api-key'|'bearer';failure?:DockApiFailure}>[];
 copyChoices:readonly Readonly<{id:string;label:string;slotId:string}>[];
}>;
export type ApiConfiguration=Readonly<{operationId:string;consent:readonly string[];credentials?:Readonly<Record<string,string>>;clearSlots?:readonly string[]}>;
export type ApiAssociation=Readonly<{operationId:string;draftOwner:ApiOwner;targetOwner:ApiOwner;source:WidgetDetailSource;requestIds:readonly string[]}>;
export interface DockApiConsumer{
 validate(dock:DockContribution,widget:CustomDockWidget):Promise<void>;
 setVisible(surface:string,sources:readonly WidgetDetailSource[]):void;
 reading(itemId:string,requestId:string):ApiReading;
 refresh(itemId:string):Promise<void>;
 identity(source:WidgetDetailSource):string;
 health():ApiHealth;
 close():Promise<void>;
}
export const apiRequirements=(source:WidgetDetailSource):readonly DockApiRequirement[]=>source.manifest.dock.data.filter((value):value is DockApiRequirement=>value.kind==='api');
export function instanceApiOwner(source:WidgetDetailSource):ApiOwner{
 return{accountId:source.accepted.scope.accountId,executionInstallationId:source.accepted.scope.installationId,definitionId:source.accepted.widget.definition.definitionId,ownerKind:'instance',ownerId:source.item.id};
}
