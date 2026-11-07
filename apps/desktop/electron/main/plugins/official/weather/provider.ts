/**
 * [INPUT]: The existing bounded system-proxy HTTPS transport and Open-Meteo contracts.
 * [OUTPUT]: Validated city search with query-script language selection and current weather reads.
 * [POS]: Weather network adapter; fixed endpoints, no ambient cookies or secrets.
 */
import {performance} from 'node:perf_hooks';
import {z} from 'zod';
import {directApiRequest} from '../../../system-dock/widgets/api/transport';
import {weatherCitySchema,weatherTimeZoneSchema,type WeatherCity} from '../../../../../shared/system-dock/widgets/weather';
export type WeatherObservation={temperature:number;feelsLike:number;humidity:number;code:number;observedAt:number;timeZone:string};
export type WeatherRequest=(url:URL,signal:AbortSignal)=>Promise<unknown>;
export const weatherRequest:WeatherRequest=async(url,signal)=>{
 const response=await directApiRequest({url,method:'GET',headers:{}},{attempts:0,headerBytes:0,responseBytes:0,deadline:performance.now()+20_000},signal).catch(error=>{signal.throwIfAborted();throw new Error('WEATHER_NETWORK_FAILED',{cause:error});});
 if(response.status===429)throw new Error('WEATHER_RATE_LIMITED');
 if(response.status!==200)throw new Error('WEATHER_NETWORK_FAILED');
 try{return JSON.parse(response.body.toString('utf8'));}catch{throw new Error('WEATHER_RESPONSE_INVALID');}
};
export async function searchWeatherCities(query:string,locale:string,signal:AbortSignal,request:WeatherRequest=weatherRequest):Promise<WeatherCity[]>{
 const language=/\p{Script=Han}/u.test(query)&&!locale.startsWith('ja')?'zh':locale.split('-')[0]!;
 const url=new URL('https://geocoding-api.open-meteo.com/v1/search');url.search=new URLSearchParams({name:query,count:'10',language,format:'json'}).toString();
 const response=z.object({results:z.array(z.object({id:z.number(),name:z.string(),admin1:z.string().optional(),country:z.string().optional(),latitude:z.number(),longitude:z.number(),timezone:z.string()})).max(10).optional()}).parse(await request(url,signal));
 return(response.results??[]).map(value=>weatherCitySchema.parse({id:value.id,name:value.name,region:value.admin1??'',country:value.country??'',latitude:value.latitude,longitude:value.longitude,timeZone:value.timezone}));
}
export async function readWeather(point:{latitude:number;longitude:number},signal:AbortSignal,request:WeatherRequest=weatherRequest):Promise<WeatherObservation>{
 const url=new URL('https://api.open-meteo.com/v1/forecast');url.search=new URLSearchParams({latitude:String(point.latitude),longitude:String(point.longitude),current:'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code',temperature_unit:'celsius',timeformat:'unixtime',timezone:'auto',forecast_days:'1'}).toString();
 const parsed=z.object({timezone:weatherTimeZoneSchema,current:z.object({temperature_2m:z.number().min(-100).max(70),apparent_temperature:z.number().min(-120).max(100),relative_humidity_2m:z.number().min(0).max(100),weather_code:z.number().int().min(0).max(99),time:z.number().int().positive().max(8_640_000_000_000)})}).safeParse(await request(url,signal));
 if(!parsed.success)throw new Error('WEATHER_RESPONSE_INVALID');
 const {current,timezone}=parsed.data;return{temperature:current.temperature_2m,feelsLike:current.apparent_temperature,humidity:current.relative_humidity_2m,code:current.weather_code,observedAt:current.time*1000,timeZone:timezone};
}
