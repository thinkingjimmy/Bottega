/**
 * [INPUT]: Depends on public bounded summary/data contracts, portable instance settings, live activation metadata and Weather forecasts.
 * [OUTPUT]: Provides activation-bound custom Widget faces, official package availability and trusted fallback projections and standard detail snapshots with declared Base/API metadata.
 * [POS]: Dock projection boundary; author code receives neither this bridge nor the underlying data owners.
 */
import type {DockSummaryNode,DockSummarySize} from '@bottega/contracts/plugins/dock/summary';
import type {DockReading,DockReadingState} from '@bottega/contracts/plugins/dock/data';
import type {DockDetailPresentation} from './native';
import type {DockApiField} from '@bottega/contracts/plugins/dock/api';
import type {DockAction} from '@bottega/contracts/plugins/dock/session';
import type {WeatherFaceReading} from './weather/forecast';
import type {OfficialWidgetId} from './catalog/distribution';
import type {WidgetFace} from '../ipc';
export type WidgetAvailabilityState='needs-install'|'needs-installation'|'package-preparing'|'installing';
export type CustomWidgetFace=Readonly<{type:'custom';plugin?:Readonly<{pluginId:string;contributionId:string;instanceId:string;customCard:boolean;configuration:Record<string,unknown>;revision:string;activationId?:string;dataRevision?:number|string;width:number;height:number}>;size:DockSummarySize;state:DockReadingState|WidgetAvailabilityState;refreshing?:boolean;summaryError?:true;summaryErrorCode?:string;updateAvailable?:boolean;summary:DockSummaryNode|null;description:string|null;readings:Readonly<Record<string,DockReading>>;weather?:WeatherFaceReading;officialWidget?:OfficialWidgetId;activity?:Extract<WidgetFace,{type:'builtin.ai-activity'}>}>;
export type CustomWidgetDetail=Readonly<{itemId:string;name:string;face:CustomWidgetFace;data:readonly Readonly<{id:string;kind:'clock'|'limits'|'activity'|'tasks'|'base'|'api';reading:DockReading;label?:string;fields?:readonly DockApiField[];attribution?:Readonly<{label:string;url:string}>;operation?:'count'|'sum'|'records'|'group'|'history';timeZone?:string;deadline?:string}>[];updatedAt:number|null;surface:DockDetailPresentation|null;actions:readonly DockAction[]}>;
