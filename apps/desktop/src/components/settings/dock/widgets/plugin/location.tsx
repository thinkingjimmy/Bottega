/**
 * [INPUT]: Trusted weather control IPC, the loaded Dock catalog and a portable location value.
 * [OUTPUT]: Current-location authorization and searchable, keyboard-accessible city selection.
 * [POS]: Host form control; cancellation never changes the saved Widget layout.
 */
import {useEffect,useEffectEvent,useState} from 'react';
import {useAppTranslation} from '@/components/providers/preferences/i18n-provider';
import {weatherLocationSchema,type WeatherCity,type WeatherLocation} from '../../../../../../shared/system-dock/widgets/weather';
import {weatherFailureKey} from '../../../../../../shared/system-dock/widgets/weather/errors';
import '@/lib/platform/system-dock-settings-client';
export function WeatherLocationField({value,disabled,onChange,onValid}:{value:unknown;disabled:boolean;onChange(value:WeatherLocation|undefined):void;onValid(valid:boolean):void}){
 const {t}=useAppTranslation(),copy=(key:string)=>t(`systemDock.weather.${key}`),parsed=weatherLocationSchema.safeParse(value);
 const initialMode=parsed.success?parsed.data.mode:'current';
 const [mode,setMode]=useState<'current'|'city'>(initialMode),[query,setQuery]=useState(''),[cities,setCities]=useState<WeatherCity[]>([]),[busy,setBusy]=useState(initialMode==='current'),[error,setError]=useState(''),[located,setLocated]=useState(false),[searched,setSearched]=useState(false),[retry,setRetry]=useState(0);
 const selected=parsed.success&&parsed.data.mode==='city'?parsed.data.city:null;
 const validCity=Boolean(selected),notifyValidity=useEffectEvent((valid:boolean)=>onValid(valid));
 const locationReady=useEffectEvent(()=>{setLocated(true);onChange({mode:'current'});onValid(true);});
 const requestFailed=useEffectEvent((cause:unknown,search:boolean)=>setError(copy(search?'searchFailed':weatherFailureKey(cause))));
 useEffect(()=>{if(mode==='city')notifyValidity(validCity);},[mode,validCity]);
 useEffect(()=>{
  const bridge=window.systemDockSettings;if(!bridge)return;
  let live=true;const requestId=crypto.randomUUID(),cancel=()=>{live=false;void bridge.weatherControl({kind:'cancel',requestId}).catch(()=>{});};
  if(mode==='current'){
   void bridge.weatherControl({kind:'locate',requestId}).then(result=>{if(live&&result.kind==='located')locationReady();},cause=>{if(live)requestFailed(cause,false);}).finally(()=>{if(live)setBusy(false);});
   return cancel;
  }
  if(query.trim().length<2)return cancel;
  const timer=setTimeout(()=>{void bridge.weatherControl({kind:'search',requestId,query:query.trim()}).then(result=>{if(live&&result.kind==='cities'){setCities(result.cities);setSearched(true);}},cause=>{if(live){setCities([]);requestFailed(cause,true);}}).finally(()=>{if(live)setBusy(false);});},300);
  return()=>{clearTimeout(timer);cancel();};
 },[mode,query,retry]);
 const changeMode=(next:'current'|'city')=>{setMode(next);setError('');setCities([]);setQuery('');setLocated(false);setSearched(false);setBusy(next==='current');onValid(false);onChange(next==='current'?{mode:'current'}:undefined);};
 const locateAgain=()=>{setBusy(true);setError('');setLocated(false);onValid(false);setRetry(value=>value+1);};
 const choose=(city:WeatherCity)=>{onChange({mode:'city',city});onValid(true);};
 return <fieldset disabled={disabled} className="space-y-3" data-weather-location="">
  <legend className="mb-2 text-sm font-medium">{copy('name')}</legend>
  <div className="flex flex-wrap gap-4 text-sm">{(['current','city'] as const).map(option=><label key={option} className="flex items-center gap-2"><input type="radio" name="weather-location-mode" checked={mode===option} onChange={()=>changeMode(option)}/>{copy(option)}</label>)}</div>
  {mode==='current'?<div className="space-y-2 text-sm"><p role="status">{busy?copy('locating'):located?copy('located'):''}</p>{!busy&&!located&&<button type="button" className="min-h-10 rounded-md border px-3" onClick={locateAgain}>{copy('useCurrent')}</button>}</div>:<div className="space-y-2">
   <input type="search" aria-label={copy('search')} placeholder={copy('search')} className="min-h-10 w-full rounded-md border bg-transparent px-3 text-sm" value={query} onChange={event=>{setCities([]);setSearched(false);setError('');setBusy(event.target.value.trim().length>=2);setQuery(event.target.value);}} onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();event.currentTarget.parentElement?.querySelector<HTMLButtonElement>('[data-weather-city]')?.focus();}}}/>
   {selected&&<p className="text-sm" data-weather-selected="">{[selected.name,selected.region,selected.country].filter(Boolean).join(', ')}</p>}
   <ul aria-busy={busy} className="max-h-48 overflow-auto">{cities.map(city=><li key={city.id}><button type="button" data-weather-city={city.id} aria-pressed={selected?.id===city.id} className="min-h-10 w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted focus-visible:outline" onClick={()=>choose(city)} onKeyDown={event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const row=event.currentTarget.closest('li');(event.key==='ArrowDown'?row?.nextElementSibling:row?.previousElementSibling)?.querySelector<HTMLButtonElement>('button')?.focus();}}}>{[city.name,city.region,city.country].filter(Boolean).join(', ')}</button></li>)}</ul>
   {!busy&&searched&&!cities.length&&!error&&<p role="status" className="text-sm">{copy('noCities')}</p>}
  </div>}
  {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  <p className="text-xs text-muted-foreground">{copy('usage')}</p>
 </fieldset>;
}
