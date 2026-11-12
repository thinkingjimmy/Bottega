/**
 * [INPUT]: The existing bounded system-proxy HTTPS transport and Open-Meteo contracts.
 * [OUTPUT]: Validated city search with query-script language selection, current weather and local daily forecasts.
 * [POS]: Weather network adapter; fixed endpoints, no ambient cookies or secrets.
 */
import {performance} from 'node:perf_hooks';
import {z} from 'zod';
import {directApiRequest} from '../../../system-dock/widgets/api/transport';
import { weatherCitySchema, weatherCodeSchema, weatherTemperatureSchema, weatherTimeZoneSchema, type WeatherCity } from '../../../../../shared/system-dock/widgets/weather';
import { WEATHER_FORECAST_DAYS, type WeatherDay, type WeatherFaceReading } from '../../../../../shared/system-dock/widgets/weather/forecast';

export type WeatherObservation = Omit<WeatherFaceReading, 'city'> & {
  feelsLike: number;
  humidity: number;
  observedAt: number;
  timeZone: string;
};
export type WeatherRequest=(url:URL,signal:AbortSignal)=>Promise<unknown>;
const unixTime = z.number().int().positive().max(253_402_214_400);
const currentResponse = z.object({
  timezone: weatherTimeZoneSchema,
  current: z.object({
    time: unixTime, temperature_2m: weatherTemperatureSchema, weather_code: weatherCodeSchema,
    apparent_temperature: z.number().min(-120).max(100), relative_humidity_2m: z.number().min(0).max(100),
  }),
});
const dailyResponse = z.object({
  utc_offset_seconds: z.number().int().min(-43_200).max(50_400),
  daily: z.object({
    time: z.array(unixTime).max(WEATHER_FORECAST_DAYS),
    weather_code: z.array(weatherCodeSchema.nullable()).max(WEATHER_FORECAST_DAYS),
    temperature_2m_max: z.array(weatherTemperatureSchema.nullable()).max(WEATHER_FORECAST_DAYS),
    temperature_2m_min: z.array(weatherTemperatureSchema.nullable()).max(WEATHER_FORECAST_DAYS),
  }),
});
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
export async function readWeather(
  point: { latitude: number; longitude: number }, signal: AbortSignal, request: WeatherRequest = weatherRequest,
): Promise<WeatherObservation> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({
    latitude: String(point.latitude), longitude: String(point.longitude),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    temperature_unit: 'celsius', timeformat: 'unixtime', timezone: 'auto', forecast_days: String(WEATHER_FORECAST_DAYS),
  }).toString();
  const raw = await request(url, signal);
  const parsed = currentResponse.safeParse(raw);
  if (!parsed.success) throw new Error('WEATHER_RESPONSE_INVALID');
  const { current, timezone } = parsed.data;
  return {
    temperature: current.temperature_2m, feelsLike: current.apparent_temperature,
    humidity: current.relative_humidity_2m, code: current.weather_code,
    observedAt: current.time * 1000, timeZone: timezone, ...readDays(raw, current.time),
  };
}

function readDays(raw: unknown, observed: number): Pick<WeatherObservation, 'today' | 'upcoming'> {
  const parsed = dailyResponse.safeParse(raw);
  if (!parsed.success) return { today: null, upcoming: [] };
  const { daily, utc_offset_seconds: offset } = parsed.data;
  // The API uses the returned offset for its local daily boundaries.
  const dateAt = (time: number) => new Date((time + offset) * 1000).toISOString().slice(0, 10);
  const today = dateAt(observed);
  const last = dateAt(observed + (WEATHER_FORECAST_DAYS - 1) * 86_400);
  const days = new Map<string, WeatherDay>();
  for (const [index, time] of daily.time.entries()) {
    const high = daily.temperature_2m_max[index], low = daily.temperature_2m_min[index], code = daily.weather_code[index];
    const date = dateAt(time);
    if (high == null || low == null || code == null || high < low || date < today || date > last) continue;
    days.set(date, { date, code, high, low });
  }
  const upcoming = [...days.values()].filter(day => day.date > today).sort((a, b) => a.date.localeCompare(b.date));
  return { today: days.get(today) ?? null, upcoming };
}
