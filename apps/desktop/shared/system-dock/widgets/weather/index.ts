/**
 * [INPUT]: Zod and the portable Widget instance contract.
 * [OUTPUT]: Official weather identity, location configuration, bounded city results, valid IANA time zones and host control.
 * [POS]: Shared weather contract; automatic coordinates never enter portable settings.
 */
import {z} from 'zod';
export const WEATHER_PLUGIN_ID='bottega-weather';
export const WEATHER_CONTRIBUTION_ID='current';
export const WEATHER_REFRESH_MS=900_000;
export const weatherTimeZoneSchema=z.string().min(1).max(80).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}});
export const weatherCitySchema=z.object({id:z.number().int().positive(),name:z.string().min(1).max(160),region:z.string().max(160),country:z.string().max(160),latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180),timeZone:weatherTimeZoneSchema}).strict();
export const weatherLocationSchema=z.discriminatedUnion('mode',[z.object({mode:z.literal('current')}).strict(),z.object({mode:z.literal('city'),city:weatherCitySchema}).strict()]);
export const weatherConfigurationSchema=z.object({location:weatherLocationSchema}).strict();
const requestId=z.string().uuid();
export const weatherControlSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('locate'),requestId}).strict(),
 z.object({kind:z.literal('search'),requestId,query:z.string().trim().min(2).max(160)}).strict(),
 z.object({kind:z.literal('cancel'),requestId}).strict(),
]);
export type WeatherCity=z.infer<typeof weatherCitySchema>;
export type WeatherLocation=z.infer<typeof weatherLocationSchema>;
export type WeatherControl=z.infer<typeof weatherControlSchema>;
export type WeatherControlResult={kind:'located'}|{kind:'cities';cities:WeatherCity[]}|{kind:'cancelled'};
