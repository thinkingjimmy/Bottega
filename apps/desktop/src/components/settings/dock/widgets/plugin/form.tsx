/**
 * [INPUT]: Canonical plugin Widget form, JSON Schema fields, official Weather city and size fields and exact layout CAS mutation.
 * [OUTPUT]: PluginWidgetFormDialog for independent instance configuration with retained conflict/error drafts.
 * [POS]: Unified Widget Settings adapter; writes instance settings through main and never edits plugin source.
 */
import { WeatherCityField } from './location';
import { WeatherSizeField } from './weather-size';
import {WEATHER_PLUGIN_ID,weatherLocationSchema} from '../../../../../../shared/system-dock/widgets/weather';
import { useId,useRef,useState } from 'react';
import { Dialog,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from '@ai-chat/ui/components/ui/dialog';
import { AppDialogBody,AppDialogContent } from '@ai-chat/ui/components/ui/app-dialog';
import { useAppTranslation } from '@/components/providers/preferences/i18n-provider';
import { SettingsAlert,SettingsButton } from '@/components/settings/settings-layout';
import type { PluginWidgetForm } from '../../../../../../shared/system-dock/widgets/plugin';
import type { DockEdge } from '../../../../../../shared/system-dock/local-state';
import '@/lib/platform/system-dock-settings-client';
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
export function PluginWidgetFormDialog({form,edge,onClose,onChanged,onReturnFocus=()=>undefined}:{form:PluginWidgetForm;edge:DockEdge;onClose:()=>void;onChanged:()=>void;onReturnFocus?:()=>void}){
  const {t}=useAppTranslation(),base=useId(),properties=record(form.settingsSchema.properties),required=new Set(Array.isArray(form.settingsSchema.required)?form.settingsSchema.required:[]);
  const [name,setName]=useState(form.name),[size,setSize]=useState(form.size),[values,setValues]=useState<Record<string,unknown>>(()=>({...Object.fromEntries(Object.entries(properties).map(([key,schema])=>[key,record(schema).default])),...form.configuration}));
  const weather=form.pluginId===WEATHER_PLUGIN_ID;
  const [editingCity, setEditingCity] = useState(false);
  const location = weather ? weatherLocationSchema.safeParse(values.location) : null;
  const city = location?.success ? location.data.city : null;
  const canSave = weather ? Boolean(city) && !editingCity : Boolean(name.trim());
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),lock=useRef(false);
  const close=()=>{if(!busy){onClose();onReturnFocus();}};
  const save=async()=>{if(lock.current||!canSave)return;lock.current=true;setBusy(true);setError('');try{
    const configuration=location?.success ? { location: location.data } : Object.fromEntries(Object.entries(properties).flatMap(([key,raw])=>{const schema=record(raw),value=values[key];
      if(value===undefined||value===''){if(required.has(key))throw new Error(`${String(schema.title??key)}: ${t('systemDock.widgets.failed')}`);return schema.type==='boolean'?[[key,false]]:[];}
      if(schema.type==='number'||schema.type==='integer'){const number=Number(value);if(!Number.isFinite(number)||(schema.type==='integer'&&!Number.isInteger(number)))throw new Error(String(schema.title??key));return[[key,number]];}
      if(schema.type==='object'||schema.type==='array')return[[key,typeof value==='string'?JSON.parse(value):value]];return[[key,value]];}));
    await window.systemDockSettings!.savePluginWidget({pluginId:form.pluginId,contributionId:form.contributionId,...(form.itemId?{itemId:form.itemId}:{}),...(!weather?{name:name.trim()}:{}),size,configuration:weather?configuration:{...form.configuration,...configuration},expectedLayoutRevision:form.layoutRevision});onChanged();onClose();onReturnFocus();
  }catch(cause){setError(cause instanceof Error?cause.message:String(cause));}finally{lock.current=false;setBusy(false);}};
  return <Dialog open onOpenChange={open=>{if(!open)close();}}><AppDialogContent aria-busy={busy} onEscapeKeyDown={event=>{
    if(busy)event.preventDefault();
    else if(editingCity){event.preventDefault();setEditingCity(false);}
  }}><DialogHeader className={weather?'mb-4':undefined}><DialogTitle>{weather?t('systemDock.weather.name'):form.name}</DialogTitle><DialogDescription className={weather?'sr-only':undefined}>{t('systemDock.widgets.configure')}</DialogDescription></DialogHeader>
    <form onSubmit={event=>{event.preventDefault();void save();}} data-plugin-widget-form="" className="contents"><AppDialogBody className="space-y-4">
      {error&&<SettingsAlert>{error}</SettingsAlert>}
      {weather ? <>
        <WeatherCityField city={city} editing={editingCity} disabled={busy} onEdit={setEditingCity} onSelect={next=>{
          setValues(current=>({...current,location:{mode:'city',city:next}}));
          setEditingCity(false);
        }} />
        <p className="text-xs text-muted-foreground">{t('systemDock.weather.usage')}</p>
        <WeatherSizeField value={size} city={city?.name} edge={edge} disabled={busy} onChange={setSize} />
      </> : <>
      <label className="grid gap-2 text-sm">{t('systemDock.widgets.name')}<input className="min-h-10 rounded-md border bg-transparent px-3" value={name} onChange={event=>setName(event.target.value)} disabled={busy} required maxLength={80}/></label>
      <label className="grid gap-2 text-sm">{t('systemDock.settings.size')}<select className="min-h-10 rounded-md border bg-transparent px-3" value={size} disabled={busy} onChange={event=>setSize(event.target.value as PluginWidgetForm['size'])}>{(['small','medium','large'] as const).map(value=><option key={value} value={value}>{t(value==='small'?'systemDock.widgets.sizeSmall':value==='medium'?'systemDock.widgets.sizeMedium':'systemDock.widgets.sizeLarge')}</option>)}</select></label>
      {Object.entries(properties).map(([key,raw])=>{const schema=record(raw),id=`${base}-${key}`,value=values[key],label=String(schema.title??key),set=(next:unknown)=>setValues(current=>({...current,[key]:next})),enums=Array.isArray(schema.enum)?schema.enum:undefined;
        const shared={id,disabled:busy,required:required.has(key),'aria-describedby':schema.description?`${id}-hint`:undefined,className:'min-h-10 w-full rounded-md border bg-transparent px-3 text-sm'};
        return <div key={key} className="grid gap-2"><label htmlFor={id} className="text-sm font-medium">{label}</label>{enums?<select {...shared} value={String(value??'')} onChange={event=>set(event.target.value)}>{enums.map(option=><option key={String(option)} value={String(option)}>{String(option)}</option>)}</select>:schema.type==='boolean'?<input {...shared} type="checkbox" required={false} className="size-5" checked={value===true} onChange={event=>set(event.target.checked)}/>:schema.type==='object'||schema.type==='array'?<textarea {...shared} className={`${shared.className} min-h-24 py-2 font-mono`} value={typeof value==='string'?value:JSON.stringify(value??(schema.type==='array'?[]:{}),null,2)} onChange={event=>set(event.target.value)}/>:<input {...shared} type="text" inputMode={schema.type==='number'||schema.type==='integer'?'decimal':'text'} value={String(value??'')} onChange={event=>set(event.target.value)} minLength={typeof schema.minLength==='number'?schema.minLength:undefined} maxLength={typeof schema.maxLength==='number'?schema.maxLength:undefined}/>} {typeof schema.description==='string'&&<p id={`${id}-hint`} className="text-xs text-muted-foreground">{schema.description}</p>}</div>;
      })}</>}
    </AppDialogBody><DialogFooter className={weather?'mt-4':undefined}><SettingsButton type="button" variant="ghost" disabled={busy} onClick={close}>{t('common.cancel')}</SettingsButton><SettingsButton type="submit" disabled={busy||!canSave}>{t('common.save')}</SettingsButton></DialogFooter></form>
  </AppDialogContent></Dialog>;
}
