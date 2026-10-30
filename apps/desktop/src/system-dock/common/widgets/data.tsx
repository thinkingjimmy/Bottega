/**
 * [INPUT]: Depends on current host detail data, declared API field labels/units, structured request failures, explicit locale/translation and bounded reading tables.
 * [OUTPUT]: Provides WidgetDataCards with generic API readings, attribution and honest update/failure metadata for Dock and authoring preview.
 * [POS]: Pure host content; it neither queries data nor accepts author code or owner capabilities.
 */
import type {CustomWidgetDetail} from '../../../../shared/system-dock/widgets/runtime';
import type {DockT} from '../format';
import {readingIsUsable,readingStateKey,readingValueText} from './readings';
import {WidgetReadingTables} from './tables';
const FIELDS=new Set(['time','date','remainingDays','remainingHours','remainingSeconds','remaining','maximum','resetsAt','tokens','costUsd','unpricedTokens','running','waiting','total','count','sum','numericCount','groupCount']);
const BASE_TITLES={count:'systemDock.widgets.fields.count',sum:'systemDock.widgets.fields.sum',records:'systemDock.widgets.base.records',group:'systemDock.widgets.base.groups',history:'systemDock.widgets.base.history'}as const;
export function WidgetDataCards({data,locale,t}:{data:CustomWidgetDetail['data'];locale:string;t:DockT}){
 return <ul className="plain-list cards grid list-none gap-3 p-2">{data.map(source=><li key={source.id} data-widget-data-source={source.id} className="card rounded-lg border p-3">
  <h3 className="card-title mb-2 text-sm font-medium">{source.label??t(source.operation?BASE_TITLES[source.operation]:`systemDock.widgets.sources.${source.kind}`)}</h3>
  {source.reading.state!=='ready'&&<p className="note text-xs">{t(readingStateKey(source.reading.state))}</p>}
  {source.kind==='api'&&source.reading.failure&&<p className="note text-xs">{t('systemDock.widgets.api.failures.'+source.reading.failure.code)}{source.reading.failure.status?' '+t('systemDock.widgets.api.httpStatus',{status:source.reading.failure.status}):''}{source.reading.failure.retryAt&&Number.isFinite(new Date(source.reading.failure.retryAt).getTime())?' '+t('systemDock.widgets.api.retryAt',{time:new Intl.DateTimeFormat(locale,{dateStyle:'short',timeStyle:'short'}).format(source.reading.failure.retryAt)}):''}</p>}
  {source.kind==='api'&&readingIsUsable(source.reading)&&<>
   <dl className="readings space-y-2">{source.fields?.filter(field=>field.type!=='series').map(field=>{
    const value=source.reading.values[field.id],at=field.type==='date'&&(typeof value==='number'||typeof value==='string')?new Date(value).getTime():NaN,text=field.type==='date'?(Number.isFinite(at)?new Intl.DateTimeFormat(locale,{dateStyle:'short',timeStyle:'short'}).format(at):'—'):field.type==='boolean'&&typeof value==='boolean'?t(value?'systemDock.widgets.api.yes':'systemDock.widgets.api.no'):readingValueText(value,locale);
    return <div key={field.id} data-widget-api-field={field.id} className="reading flex items-baseline justify-between gap-3 text-xs"><dt>{field.label}</dt><dd><strong>{text}{field.unit&&value!==null&&value!==undefined?' '+field.unit:''}</strong></dd></div>;
   })}</dl>
   {source.fields?.filter(field=>field.type==='series').map(field=><div key={field.id} data-widget-api-field={field.id}><h4 className="mt-2 text-xs font-medium">{field.label}{field.unit?' ('+field.unit+')':''}</h4><WidgetReadingTables reading={{...source.reading,records:undefined,groups:undefined,values:{series:source.reading.values[field.id]??null}}} locale={locale} t={t}/></div>)}
   <WidgetReadingTables reading={{...source.reading,values:{}}} locale={locale} t={t}/>
  </>}
  {source.kind!=='api'&&readingIsUsable(source.reading)&&<><dl className="readings space-y-2">{Object.entries(source.reading.values).filter(([field])=>FIELDS.has(field)).map(([field,value])=>{
   const date=field==='resetsAt'&&typeof value==='number'&&Number.isFinite(value)?new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short'}).format(value):null;
   return <div className="reading flex items-baseline justify-between gap-3 text-xs" key={field}><dt>{t(`systemDock.widgets.fields.${field}`)}</dt><dd><strong>{date??readingValueText(value,locale,field==='costUsd'?'currency':field==='remaining'?'percent':undefined)}</strong></dd></div>;
  })}</dl><WidgetReadingTables reading={source.reading} timeZone={source.timeZone} locale={locale} t={t}/></>}
  {source.timeZone&&<p className="row-meta mt-2 text-xs">{t('systemDock.widgets.dateZone',{zone:source.timeZone})}</p>}
  {source.deadline&&<p className="row-meta mt-2 text-xs">{t('systemDock.widgets.deadline',{date:new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short',timeZone:source.timeZone??undefined}).format(new Date(source.deadline))})}</p>}
  {source.kind==='api'&&source.reading.updatedAt!==null&&Number.isFinite(new Date(source.reading.updatedAt).getTime())&&<p className="row-meta mt-2 text-xs">{t('systemDock.panel.updated',{time:new Intl.DateTimeFormat(locale,{dateStyle:'short',timeStyle:'short'}).format(source.reading.updatedAt)})}</p>}
  {source.attribution&&<p className="row-meta mt-2 text-xs">{t('systemDock.widgets.api.attribution',{name:source.attribution.label})}</p>}
 </li>)}</ul>;
}
