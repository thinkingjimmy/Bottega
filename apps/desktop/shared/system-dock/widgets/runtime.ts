/**
 * [INPUT]: Depends on public bounded summary/data contracts and portable instance settings.
 * [OUTPUT]: Provides privacy-safe custom Widget faces with host installation/preparation states and retained-setting notices and host-owned standard detail snapshots with declared Base/API metadata and structured request failures.
 * [POS]: Dock projection boundary; author code receives neither this bridge nor the underlying data owners.
 */
import type {DockSummaryNode,DockSummarySize} from '@bottega/contracts/plugins/dock/summary';
import type {DockReading,DockReadingState} from '@bottega/contracts/plugins/dock/data';
import type {DockDetailPresentation} from './native';
import type {DockApiField} from '@bottega/contracts/plugins/dock/api';
import type {DockAction} from '@bottega/contracts/plugins/dock/session';
export type WidgetAvailabilityState='needs-installation'|'package-preparing'|'installing';
export type CustomWidgetFace=Readonly<{type:'custom';size:DockSummarySize;state:DockReadingState|WidgetAvailabilityState;updateAvailable?:boolean;summary:DockSummaryNode|null;description:string|null;readings:Readonly<Record<string,DockReading>>}>;
export type CustomWidgetDetail=Readonly<{itemId:string;name:string;face:CustomWidgetFace;data:readonly Readonly<{id:string;kind:'clock'|'limits'|'activity'|'tasks'|'base'|'api';reading:DockReading;label?:string;fields?:readonly DockApiField[];attribution?:Readonly<{label:string;url:string}>;operation?:'count'|'sum'|'records'|'group'|'history';timeZone?:string;deadline?:string}>[];updatedAt:number|null;surface:DockDetailPresentation|null;actions:readonly DockAction[]}>;
