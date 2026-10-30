/**
 * [INPUT]: Depends on validated summary nodes, typed host readings and Intl formatting.
 * [OUTPUT]: Provides one readable-state policy, localized numeric/duration values, zone-aware record dates and bounded summary descriptions.
 * [POS]: Shared host/renderer Widget formatting leaf; the resident bar receives a bounded host description.
 */
import type {DockColumn,DockReading,DockReadingState} from '@bottega/contracts/plugins/dock/data';
import type {DockSummaryNode,DockSummaryText} from '@bottega/contracts/plugins/dock/summary';
export const readingIsUsable=(reading:DockReading|undefined)=>reading!==undefined&&['ready','partial','stale'].includes(reading.state);
export const readingStateKey=(state:DockReadingState|import('./runtime').WidgetAvailabilityState)=>`systemDock.widgets.states.${state}`;
export function summaryText(value:DockSummaryText,readings:Readonly<Record<string,DockReading>>,locale:string):string{
 if(value.kind==='literal')return value.value;
 const reading=readings[value.source];if(!readingIsUsable(reading))return '—';
 return readingValueText(reading!.values[value.field],locale,value.format);
}
export function readingValueText(value:unknown,locale:string,format?:string):string{
 if(value===null||value===undefined||typeof value==='object')return '—';
 if(typeof value==='number'){
  if(!Number.isFinite(value))return '—';
  if(format==='percent')return new Intl.NumberFormat(locale,{style:'percent',maximumFractionDigits:0}).format(value/100);
  if(format==='currency')return new Intl.NumberFormat(locale,{style:'currency',currency:'USD',maximumFractionDigits:2}).format(value);
  if(format==='duration'){
   const magnitude=Math.abs(value),[unit,divisor]:[string,number]=magnitude>=86400?['day',86400]:magnitude>=3600?['hour',3600]:magnitude>=60?['minute',60]:['second',1];
   return new Intl.NumberFormat(locale,{style:'unit',unit,unitDisplay:'short',maximumFractionDigits:1}).format(value/divisor);
  }
  if(format==='date')return Number.isFinite(new Date(value).getTime())?new Intl.DateTimeFormat(locale,{dateStyle:'short'}).format(value):'—';
  return new Intl.NumberFormat(locale,{maximumFractionDigits:2}).format(value);
 }
 return String(value).slice(0,160);
}
export function readingRecordText(value:unknown,column:Pick<DockColumn,'type'>|undefined,locale:string,timeZone?:string):string{
 if(column?.type!=='date'||typeof value!=='string')return readingValueText(value,locale);
 const calendar=/^\d{4}-\d\d-\d\d$/.test(value),at=Date.parse(calendar?value+'T00:00:00Z':value);
 if(!Number.isFinite(at)||calendar&&new Date(at).toISOString().slice(0,10)!==value||!calendar&&!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value))return '—';
 return new Intl.DateTimeFormat(locale,{dateStyle:'short',...(calendar?{timeZone:'UTC'}:{timeStyle:'short',timeZone})}).format(at);
}
export function summaryDescription(node:DockSummaryNode,readings:Readonly<Record<string,DockReading>>,locale:string):string{
 if('children' in node)return node.children.map(child=>summaryDescription(child,readings,locale)).filter(Boolean).join(' · ').slice(0,800);
 if('text' in node)return summaryText(node.text,readings,locale);
 if(node.type==='progress')return readingIsUsable(readings[node.source])?readingValueText(readings[node.source]?.values[node.field],locale):'—';
 return '';
}
