/**
 * [INPUT]: Depends on bounded host readings, explicit locale/translation and selected Base column types.
 * [OUTPUT]: Provides WidgetReadingTables for localized records, groups and complete half-open history.
 * [POS]: Shared host content for Dock details and authoring previews; parents admit only current usable readings.
 */
import type {DockReading} from '@bottega/contracts/plugins/dock/data';
import type {DockT} from '../format';
import {readingRecordText,readingValueText} from './readings';
const cell='p-1',heading='p-1 font-medium',table='w-full text-left text-xs';
export function WidgetReadingTables({reading,timeZone,locale,t}:{reading:DockReading;timeZone?:string;locale:string;t:DockT}){
 const value=(input:unknown)=>typeof input==='boolean'?t(input?'systemDock.widgets.base.checked':'systemDock.widgets.base.unchecked'):readingValueText(input,locale),series=reading.values.series;
 return <>
  {reading.records&&reading.records.length>0&&<div className="overflow-x-auto"><table aria-label={t('systemDock.widgets.base.records')} className={table}>
   <thead><tr>{Object.keys(reading.records[0]!.values).map(field=><th key={field} scope="col" className={heading}>{reading.columns?.find(column=>column.id===field)?.label??field}</th>)}</tr></thead>
   <tbody>{reading.records.map(row=><tr key={row.id}>{Object.entries(row.values).map(([field,input])=>{const column=reading.columns?.find(column=>column.id===field),text=column?.type==='checkbox'?value(input):readingRecordText(input,column,locale,timeZone);return <td key={field} className="max-w-40 truncate p-1" title={text}>{text}</td>;})}</tr>)}</tbody>
  </table></div>}
  {reading.groups&&reading.groups.length>0&&<table aria-label={t('systemDock.widgets.base.groups')} className={table}><thead><tr><th scope="col" className={heading}>{t('systemDock.widgets.base.value')}</th><th scope="col" className={heading}>{t('systemDock.widgets.fields.count')}</th></tr></thead>
   <tbody>{reading.groups.map(group=><tr key={JSON.stringify(group.key)}><td className="max-w-40 truncate p-1" title={group.key===null?t('systemDock.widgets.base.emptyValue'):value(group.key)}>{group.key===null?t('systemDock.widgets.base.emptyValue'):value(group.key)}</td><td className={cell}>{value(group.count)}</td></tr>)}</tbody>
  </table>}
  {series!==null&&typeof series==='object'&&<><table aria-label={t('systemDock.widgets.base.history')} className={table}><thead><tr><th scope="col" className={heading}>{t('systemDock.widgets.fields.date')}</th><th scope="col" className={heading}>{t('systemDock.widgets.base.value')}</th></tr></thead>
   <tbody>{series.points.map(point=><tr key={point.at}><td className={cell}>{new Intl.DateTimeFormat(locale,{dateStyle:'short',timeZone:series.timeZone}).format(point.at)}</td><td className={cell}>{value(point.value)}</td></tr>)}</tbody>
  </table><p className="row-meta">{t('systemDock.widgets.base.range',{from:new Intl.DateTimeFormat(locale,{dateStyle:'short',timeZone:series.timeZone}).format(series.from),to:new Intl.DateTimeFormat(locale,{dateStyle:'short',timeZone:series.timeZone}).format(series.to)})}</p></>}
 </>;
}
