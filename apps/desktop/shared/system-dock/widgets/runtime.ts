/**
 * [INPUT]: Depends on public bounded summary/data contracts and portable instance settings and exact live activation metadata.
 * [OUTPUT]: Provides privacy-safe activation-bound custom Widget faces with host installation/preparation states and retained-setting/summary-refresh notices and host-owned standard detail snapshots with declared Base/API metadata structured request failures and bounded summary error codes.
 * [POS]: Dock projection boundary; author code receives neither this bridge nor the underlying data owners.
 */
import type {DockSummaryNode,DockSummarySize} from '@bottega/contracts/plugins/dock/summary';
import type {DockReading,DockReadingState} from '@bottega/contracts/plugins/dock/data';
import type {DockDetailPresentation} from './native';
import type {DockApiField} from '@bottega/contracts/plugins/dock/api';
import type {DockAction} from '@bottega/contracts/plugins/dock/session';
export type WidgetAvailabilityState='needs-installation'|'package-preparing'|'installing';
export type CustomWidgetFace=Readonly<{type:'custom';plugin?:Readonly<{pluginId:string;contributionId:string;instanceId:string;customCard:boolean;configuration:Record<string,unknown>;revision:string;activationId?:string;width:number;height:number}>;size:DockSummarySize;state:DockReadingState|WidgetAvailabilityState;refreshing?:boolean;summaryError?:true;summaryErrorCode?:string;updateAvailable?:boolean;summary:DockSummaryNode|null;description:string|null;readings:Readonly<Record<string,DockReading>>}>;
export type CustomWidgetDetail=Readonly<{itemId:string;name:string;face:CustomWidgetFace;data:readonly Readonly<{id:string;kind:'clock'|'limits'|'activity'|'tasks'|'base'|'api';reading:DockReading;label?:string;fields?:readonly DockApiField[];attribution?:Readonly<{label:string;url:string}>;operation?:'count'|'sum'|'records'|'group'|'history';timeZone?:string;deadline?:string}>[];updatedAt:number|null;surface:DockDetailPresentation|null;actions:readonly DockAction[]}>;
