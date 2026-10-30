/**
 * [INPUT]: Depends on declared Base slots/aliases, bounded Main metadata, portable binding drafts and localized host copy.
 * [OUTPUT]: Provides explicit Base/field/filter selection, retained drafts, metadata retry/search and no implicit data permission.
 * [POS]: Main-window configuration only; neither source authors nor Dock renderers receive directory authority.
 */
import {useEffect,useState} from 'react';
import {useAppTranslation} from '@/components/providers/preferences/i18n-provider';
import type {DockContribution} from '@bottega/contracts/plugins/dock/manifest';
import {DOCK_BASE_BUDGET} from '@bottega/contracts/plugins/dock/data';
import type {DockBaseBinding} from '../../../../../../shared/system-dock/widgets/instance';
import type {WidgetBaseDirectory} from '../../../../../../shared/system-dock/widgets/base/access';
import {BaseBindingFilters} from './fields';
const control='min-h-10 w-full rounded-md border bg-transparent px-3 text-sm';
export function WidgetBaseBindings({dock,bindings,disabled,onChange}:{dock:DockContribution;bindings:readonly DockBaseBinding[];disabled:boolean;onChange(value:DockBaseBinding[]):void}){
 const {t}=useAppTranslation(),[directory,setDirectory]=useState<WidgetBaseDirectory|null>(null),[query,setQuery]=useState(''),[retry,setRetry]=useState(0),[loading,setLoading]=useState(true),[failed,setFailed]=useState(false);
 const sources=dock.data.filter(source=>source.kind==='base'),slots=[...new Set(sources.map(source=>source.binding))];
 useEffect(()=>{let active=true;const timer=setTimeout(()=>{void window.systemDockSettings!.widgetBaseDirectory({query}).then(value=>{if(active)setDirectory(value);},()=>{if(active)setFailed(true);}).finally(()=>{if(active)setLoading(false);});},150);return()=>{active=false;clearTimeout(timer);};},[query,retry]);
 const update=(value:DockBaseBinding)=>onChange([...bindings.filter(binding=>binding.slot!==value.slot),value].sort((a,b)=>slots.indexOf(a.slot)-slots.indexOf(b.slot)));
 const selectedCount=bindings.reduce((sum,binding)=>sum+Object.keys(binding.fields).length,0);
 return <section className="grid gap-4" data-widget-base-bindings="">
  <p className="text-sm text-muted-foreground">{t('systemDock.widgets.base.hint')}</p>
  <input type="search" aria-label={t('systemDock.widgets.base.search')} value={query} maxLength={80} disabled={disabled} onChange={event=>{setLoading(true);setFailed(false);setQuery(event.target.value);}} className={control}/>
  {loading&&<p role="status" className="text-sm text-muted-foreground">{t('systemDock.widgets.states.loading')}</p>}
  {failed&&<div role="alert"><p>{t('systemDock.widgets.base.loadFailed')}</p><button type="button" className="min-h-9 underline" onClick={()=>{setLoading(true);setFailed(false);setRetry(value=>value+1);}}>{t('common.retry')}</button></div>}
  {directory?.truncated&&<p className="text-xs text-muted-foreground">{t('systemDock.widgets.base.narrowSearch')}</p>}
  {slots.map((slot,index)=>{
   const binding=bindings.find(value=>value.slot===slot),choice=directory?.choices.find(value=>value.ownerKey===binding?.ownerKey&&value.ownerInstanceId===binding.ownerInstanceId),required=new Map<string,'number'|'date'|'any'>();
   for(const source of sources.filter(source=>source.binding===slot)){if(source.field)required.set(source.field,source.operation==='sum'||source.operation==='history'?'number':'any');if(source.timeField)required.set(source.timeField,'date');}
   const requiredAlias=[...required.keys()],key=binding?JSON.stringify([binding.ownerKey,binding.ownerInstanceId]):'';
   return <fieldset key={slot} data-widget-base-slot={slot} className="grid gap-3 rounded-md border p-4" disabled={disabled}>
    <legend className="px-1 text-sm font-medium">{t('systemDock.widgets.base.source',{index:index+1})}</legend>
    <select aria-label={t('systemDock.widgets.base.base')} disabled={disabled||loading} value={key} className={control} onChange={event=>{const selected=directory?.choices.find(value=>JSON.stringify([value.ownerKey,value.ownerInstanceId])===event.target.value);if(selected)update({slot,ownerKey:selected.ownerKey,ownerInstanceId:selected.ownerInstanceId,fields:{},filter:[]});}}>
     <option value="">{t('systemDock.widgets.base.chooseBase')}</option>{binding&&!choice&&<option value={key}>{t('systemDock.widgets.base.unavailable')}</option>}
     {directory?.choices.map(value=><option key={JSON.stringify([value.ownerKey,value.ownerInstanceId])} value={JSON.stringify([value.ownerKey,value.ownerInstanceId])}>{value.name}</option>)}
    </select>
    {binding&&choice&&<>
     {[...required].map(([alias,type])=><select key={alias} aria-label={t('systemDock.widgets.base.fieldFor',{field:alias})} disabled={disabled} value={binding.fields[alias]??''} className={control} onChange={event=>{const fields={...binding.fields};if(event.target.value)fields[alias]=event.target.value;else delete fields[alias];update({...binding,fields});}}>
      <option value="">{t('systemDock.widgets.base.chooseField')}</option>{choice.fields.filter(field=>type==='any'||field.type===type).map(field=><option key={field.id} value={field.id}>{field.name}</option>)}
     </select>)}
     <details open={choice.fields.length<=8} className="grid gap-2"><summary className="cursor-pointer text-sm font-medium">{t('systemDock.widgets.base.readFields')}</summary><div className="mt-3 grid gap-2 sm:grid-cols-2">{choice.fields.map(field=>{
      const aliases=Object.keys(binding.fields).filter(alias=>binding.fields[alias]===field.id),mandatory=aliases.some(alias=>requiredAlias.includes(alias)),checked=aliases.length>0;
      return <label key={field.id} className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" aria-label={t('systemDock.widgets.base.readField',{field:field.name})} checked={checked} disabled={disabled||mandatory||!checked&&selectedCount>=DOCK_BASE_BUDGET.baseFieldCount} onChange={event=>{
       const fields={...binding.fields};if(event.target.checked){let index=1;while(Object.hasOwn(fields,'field'+index)||required.has('field'+index))index++;fields['field'+index]=field.id;}else for(const alias of aliases)delete fields[alias];
       update({...binding,fields,filter:binding.filter.filter(filter=>Object.hasOwn(fields,filter.field))});
      }}/><span>{field.name}</span></label>;
     })}</div></details>
     <BaseBindingFilters binding={binding} fields={choice.fields} disabled={disabled} onChange={update}/>
    </>}
   </fieldset>;
  })}
 </section>;
}
