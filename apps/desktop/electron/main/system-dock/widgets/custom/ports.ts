/**
 * [INPUT]: Depends on portable Widget items, bounded runtime projections and Dock surface identities.
 * [OUTPUT]: Provides the custom Widget projection/demand port for Dock composition.
 * [POS]: Main-only seam that keeps application and data ownership outside DockService.
 */
import type {DockItem,DockWidget} from '../../../../../shared/system-dock/layout';
import type {DockEdge} from '../../../../../shared/system-dock/local-state';
import type {CustomWidgetFace,CustomWidgetDetail} from '../../../../../shared/system-dock/widgets/runtime';
import type {DockSurface} from '../usage';
import type {DockReading} from '@bottega/contracts/plugins/dock/data';
import type {WidgetDetailSource} from '../detail/ports';
export type WidgetItem=Extract<DockItem,{kind:'widget'}>;
export interface DockCustomWidgetsPort{
 face(item:WidgetItem,edge:DockEdge):CustomWidgetFace;
 detail(item:WidgetItem,edge:DockEdge):CustomWidgetDetail|null;
 setVisible(surface:DockSurface,widgets:readonly{itemId:string;widget:DockWidget}[]):void;
 refresh(itemId:string):Promise<void>;
 source(itemId:string):WidgetDetailSource|null;
 read(itemId:string,sources?:readonly string[]):Readonly<Record<string,DockReading>>;
 invokeAction?(itemId:string,ref:string):Promise<void>;
}
