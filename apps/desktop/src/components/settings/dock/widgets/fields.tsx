/**
 * [INPUT]: Depends on typed non-secret Widget settings and native accessible form controls.
 * [OUTPUT]: Provides reusable host-owned setting fields, retained invalid input and explicit local-time date conversion.
 * [POS]: Shared Widget configuration controls; credentials are never collected by this form.
 */
import {useId} from 'react';
import type {DockSetting,DockSettings} from '@bottega/contracts/plugins/dock/settings';
import {useAppTranslation} from '@/components/providers/preferences/i18n-provider';
function localDate(value:unknown){
 if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))return '';const date=new Date(value),pad=(value:number)=>String(value).padStart(2,'0');
 return`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
export function parsedWidgetSettings(fields:readonly DockSetting[],values:DockSettings):DockSettings{
 return Object.fromEntries(fields.map(field=>{const value=values[field.id];return[field.id,field.type==='number'&&typeof value==='string'&&value.trim()!==''&&Number.isFinite(Number(value))?Number(value):value];}));
}
export function WidgetSettingsFields({fields,values,onChange,disabled=false,invalid=[]}:{fields:readonly DockSetting[];values:DockSettings;onChange(value:DockSettings):void;disabled?:boolean;invalid?:readonly string[]}){
 const base=useId(),{t}=useAppTranslation();
 return <div className="space-y-4">{fields.map(field=>{
  const id=base+'-'+field.id,value=values[field.id],props={id,disabled,'aria-invalid':invalid.includes(field.id),className:'min-h-10 w-full rounded-md border bg-transparent px-3 text-sm'};
  const change=(value:string|number|boolean)=>onChange({...values,[field.id]:value});
  return <div key={field.id} className="grid gap-2"><label htmlFor={id} className="text-sm font-medium">{field.label}</label>
   {field.type==='toggle'?<input {...props} type="checkbox" checked={value===true} onChange={event=>change(event.target.checked)} className="size-5" />
    :field.type==='select'?<select {...props} value={String(value??'')} onChange={event=>change(event.target.value)}>{field.options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>
    :field.type==='date'?<><input {...props} type="datetime-local" step={1} value={localDate(value)} onChange={event=>{const date=new Date(event.target.value);change(Number.isFinite(date.getTime())?date.toISOString():'');}} aria-describedby={id+'-zone'} /><p id={id+'-zone'} className="text-xs text-muted-foreground">{t('systemDock.widgets.dateZone',{zone:Intl.DateTimeFormat().resolvedOptions().timeZone})}</p></>
     :<input {...props} type="text" inputMode={field.type==='number'?'decimal':'text'} value={String(value??'')} onChange={event=>change(event.target.value)} />}
  </div>;
 })}</div>;
}
