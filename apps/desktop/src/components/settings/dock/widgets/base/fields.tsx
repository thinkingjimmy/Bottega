/**
 * [INPUT]: Depends on selected Base field metadata, portable typed filters and localized host copy.
 * [OUTPUT]: Provides bounded filter controls with explicit scalar types and date/time zones.
 * [POS]: Host Widget binding editor; author code cannot create a predicate or execute a query here.
 */
import {useAppTranslation} from '@/components/providers/preferences/i18n-provider';
import type {DockBaseBinding} from '../../../../../../shared/system-dock/widgets/instance';
import type {WidgetBaseDirectory} from '../../../../../../shared/system-dock/widgets/base/access';
type Field=WidgetBaseDirectory['choices'][number]['fields'][number];
const control='min-h-10 w-full rounded-md border bg-transparent px-3 text-sm';
export function BaseBindingFilters({binding,fields,disabled,onChange}:{binding:DockBaseBinding;fields:readonly Field[];disabled:boolean;onChange(value:DockBaseBinding):void}){
 const {t}=useAppTranslation(),selected=Object.entries(binding.fields).flatMap(([alias,id])=>{const field=fields.find(value=>value.id===id);return field?[{alias,...field}]:[];});
 const update=(index:number,filter:DockBaseBinding['filter'][number])=>onChange({...binding,filter:binding.filter.map((value,position)=>position===index?filter:value)});
 return <div className="grid gap-3"><p className="text-sm font-medium">{t('systemDock.widgets.base.filters')}</p>
  {binding.filter.map((filter,index)=>{
   const field=selected.find(value=>value.alias===filter.field),ops=field?.type==='number'?['equals','not-equals','less-than','greater-than']:field?.type==='date'?['equals','not-equals','on-day']:['equals','not-equals'];
   return <div key={index} data-base-filter="" className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
    <select aria-label={t('systemDock.widgets.base.filterField')} disabled={disabled} value={filter.field} className={control} onChange={event=>update(index,{field:event.target.value,op:'equals',value:null})}>
     {selected.map(value=><option key={value.alias} value={value.alias}>{value.name}</option>)}
    </select>
    <select aria-label={t('systemDock.widgets.base.condition')} disabled={disabled} value={filter.op} className={control} onChange={event=>update(index,{...filter,op:event.target.value as typeof filter.op,value:null,...(event.target.value==='on-day'?{timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone}:{timeZone:undefined})})}>
     {ops.map(op=><option key={op} value={op}>{t(op==='equals'?'systemDock.widgets.base.equals':op==='not-equals'?'systemDock.widgets.base.notEquals':op==='less-than'?'systemDock.widgets.base.lessThan':op==='greater-than'?'systemDock.widgets.base.greaterThan':'systemDock.widgets.base.onDay')}</option>)}
    </select>
    {filter.op==='on-day'?<><input type="date" aria-label={t('systemDock.widgets.fields.date')} disabled={disabled} className={control} value={typeof filter.value==='string'?filter.value:''} onChange={event=>update(index,{...filter,value:event.target.value})}/><input aria-label={t('systemDock.widgets.base.timeZone')} disabled={disabled} className={control} value={filter.timeZone??''} onChange={event=>update(index,{...filter,timeZone:event.target.value})}/></>
     :field?.type==='checkbox'?<select aria-label={t('systemDock.widgets.base.value')} disabled={disabled} className={control} value={filter.value===true?'true':filter.value===false?'false':''} onChange={event=>update(index,{...filter,value:event.target.value===''?null:event.target.value==='true'})}><option value="">{t('systemDock.widgets.base.emptyValue')}</option><option value="true">{t('systemDock.widgets.base.checked')}</option><option value="false">{t('systemDock.widgets.base.unchecked')}</option></select>
     :<input type={field?.type==='number'?'number':'text'} aria-label={t('systemDock.widgets.base.value')} disabled={disabled} className={control} value={filter.value===null?'':String(filter.value)} onChange={event=>update(index,{...filter,value:field?.type==='number'?(event.target.value===''?null:Number(event.target.value)):event.target.value})}/>}
    <button type="button" disabled={disabled} className="min-h-9 justify-self-start text-sm underline" onClick={()=>onChange({...binding,filter:binding.filter.filter((_value,position)=>position!==index)})}>{t('systemDock.widgets.base.removeFilter')}</button>
   </div>;
  })}
  <button type="button" disabled={disabled||!selected.length||binding.filter.length>=8} className="min-h-9 justify-self-start rounded-md border px-3 text-sm disabled:opacity-50" onClick={()=>onChange({...binding,filter:[...binding.filter,{field:selected[0]!.alias,op:'equals',value:null}]})}>{t('systemDock.widgets.base.addFilter')}</button>
 </div>;
}
