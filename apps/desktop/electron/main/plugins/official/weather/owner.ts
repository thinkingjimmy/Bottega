/**
 * [INPUT]: Native location, bounded weather transport and strict portable settings.
 * [OUTPUT]: Weather host controls and localized current readings with cancellable demand.
 * [POS]: Official weather data owner; no polling, location history or automatic permission prompts.
 */
import {weatherConfigurationSchema,weatherControlSchema,WEATHER_REFRESH_MS,type WeatherControlResult} from '../../../../../shared/system-dock/widgets/weather';
import {weatherCopy} from '../../../../../shared/system-dock/widgets/weather/copy';
import {WeatherLocationOwner} from './location';
import {readWeather,searchWeatherCities,type WeatherObservation,type WeatherRequest} from './provider';
export class WeatherOwner{
 private readonly controls=new Map<string,AbortController>();
 private readonly places=new Map<string,string>();
 private readonly cache=new Map<string,{at:number;value:WeatherObservation}>();
 private readonly flights=new Map<string,{controller:AbortController;users:number;promise:Promise<WeatherObservation>}>();
 private readonly location:WeatherLocationOwner;
 constructor(directory:string,private readonly locale:()=>string,private readonly request?:WeatherRequest){this.location=new WeatherLocationOwner(directory);}
 async control(raw:unknown):Promise<WeatherControlResult>{
  const input=weatherControlSchema.parse(raw);
  if(input.kind==='cancel'){this.controls.get(input.requestId)?.abort();return{kind:'cancelled'};}
  if(this.controls.size>=8||this.controls.has(input.requestId))throw new Error('WEATHER_BUSY');
  const controller=new AbortController();this.controls.set(input.requestId,controller);
  try{if(input.kind==='locate'){await this.location.current(true,controller.signal);controller.signal.throwIfAborted();return{kind:'located'};}
   return{kind:'cities',cities:await searchWeatherCities(input.query,this.locale(),controller.signal,this.request)};
  }finally{this.controls.delete(input.requestId);}
 }
 async read(input:{instanceId:string;configuration:unknown;force?:boolean},signal:AbortSignal){
  const config=weatherConfigurationSchema.parse(input.configuration),copy=weatherCopy(this.locale());
  const point=config.location.mode==='city'?config.location.city:await this.location.current(false,signal);
  const key=JSON.stringify([point.latitude,point.longitude]),prior=this.cache.get(key);
  let value:WeatherObservation;
  try{value=!input.force&&prior&&Date.now()-prior.at<WEATHER_REFRESH_MS?prior.value:await this.fetch(key,point,signal);}
  catch(error){signal.throwIfAborted();if(config.location.mode==='current'&&this.places.has(input.instanceId)&&this.places.get(input.instanceId)!==key)throw new Error('WEATHER_LOCATION_CHANGED',{cause:error});throw error;}
  if(this.places.size>=64)this.places.delete(this.places.keys().next().value!);this.places.set(input.instanceId,key);
  signal.throwIfAborted();if(!prior||prior.value!==value){if(this.cache.size>=64)this.cache.delete(this.cache.keys().next().value!);this.cache.set(key,{at:Date.now(),value});}
  const code=value.code,condition=code===0?copy.clear:code<=2?copy.partlyCloudy:code===3?copy.cloudy:[45,48].includes(code)?copy.fog:code>=51&&code<=57?copy.drizzle:code>=61&&code<=67?copy.rain:code>=71&&code<=77||[85,86].includes(code)?copy.snow:code>=80&&code<=82?copy.showers:code>=95?copy.thunderstorm:copy.unknown;
  const label=config.location.mode==='city'?config.location.city.name:copy.current;
  return{summary:{type:'column',gap:2,children:[{type:'label',text:{kind:'literal',value:label.slice(0,80)}},{type:'primary',text:{kind:'literal',value:`${Math.round(value.temperature)}°C`}},{type:'secondary',text:{kind:'literal',value:condition}}]},
   detail:{id:'weather',kind:'api',label,reading:{state:'ready',updatedAt:value.observedAt,values:{temperature:value.temperature,'feels-like':value.feelsLike,humidity:value.humidity,condition,'observed-at':value.observedAt}},
    fields:[{id:'temperature',label:copy.temperature,type:'number',path:['temperature'],unit:'°C'},{id:'feels-like',label:copy.feelsLike,type:'number',path:['feels-like'],unit:'°C'},{id:'humidity',label:copy.humidity,type:'number',path:['humidity'],unit:'%'},{id:'condition',label:copy.condition,type:'text',path:['condition']},{id:'observed-at',label:copy.observedAt,type:'date',path:['observed-at'],timeFormat:'unix-ms'}],
    attribution:{label:copy.attribution,url:'https://open-meteo.com/'},timeZone:value.timeZone}};
 }
 private async fetch(key:string,point:{latitude:number;longitude:number},signal:AbortSignal):Promise<WeatherObservation>{
  signal.throwIfAborted();
  let flight=this.flights.get(key);
  if(!flight){const controller=new AbortController();const promise=readWeather(point,controller.signal,this.request);
   flight={controller,users:0,promise};const owned=flight;this.flights.set(key,flight);
   void promise.finally(()=>{if(this.flights.get(key)===owned)this.flights.delete(key);}).catch(()=>{});
  }
  const owned=flight;owned.users++;
  return new Promise((resolve,reject)=>{
   let settled=false;
   const finish=(error:unknown,value?:WeatherObservation)=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);owned.users--;if(!owned.users){owned.controller.abort();if(this.flights.get(key)===owned)this.flights.delete(key);}if(error)reject(error);else resolve(value!);};
   const abort=()=>finish(signal.reason??new Error('WEATHER_CANCELLED'));signal.addEventListener('abort',abort,{once:true});
   owned.promise.then(value=>finish(null,value),error=>finish(error));if(signal.aborted)abort();
  });
 }
 close(){for(const flight of this.flights.values())flight.controller.abort();this.flights.clear();for(const control of this.controls.values())control.abort();this.controls.clear();this.cache.clear();this.places.clear();}
}
