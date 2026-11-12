/**
 * [INPUT]: Zod and the bounded forecast presentation contract.
 * [OUTPUT]: Official weather identity, city configuration, cancellable city search and validated forecast projection.
 * [POS]: Shared weather contract for portable settings and trusted host responses.
 */
import {z} from 'zod';
import { WEATHER_FORECAST_DAYS, type WeatherFaceReading } from './forecast';
export const WEATHER_PLUGIN_ID='bottega-weather';
export const WEATHER_CONTRIBUTION_ID='current';
export const WEATHER_REFRESH_MS=900_000;
export const weatherTimeZoneSchema=z.string().min(1).max(80).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}});
export const weatherCitySchema=z.object({id:z.number().int().positive(),name:z.string().min(1).max(160),region:z.string().max(160),country:z.string().max(160),latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180),timeZone:weatherTimeZoneSchema}).strict();
export const weatherLocationSchema=z.object({mode:z.literal('city'),city:weatherCitySchema}).strict();
export const weatherConfigurationSchema=z.object({location:weatherLocationSchema}).strict();
export const weatherTemperatureSchema = z.number().min(-100).max(70);
export const weatherCodeSchema = z.number().int().min(0).max(99);
const weatherDaySchema = z.object({
  date: z.iso.date(), code: weatherCodeSchema, high: weatherTemperatureSchema, low: weatherTemperatureSchema,
}).strict().refine(day => day.high >= day.low);
export const weatherFaceSchema: z.ZodType<WeatherFaceReading> = z.object({
  city: weatherCitySchema.shape.name, temperature: weatherTemperatureSchema, code: weatherCodeSchema,
  today: weatherDaySchema.nullable(), upcoming: z.array(weatherDaySchema).max(WEATHER_FORECAST_DAYS - 1),
}).strict();
const requestId=z.string().uuid();
export const weatherControlSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('search'),requestId,query:z.string().trim().min(2).max(160)}).strict(),
 z.object({kind:z.literal('cancel'),requestId}).strict(),
]);
export type WeatherCity=z.infer<typeof weatherCitySchema>;
export type WeatherControl=z.infer<typeof weatherControlSchema>;
export type WeatherControlResult={kind:'cities';cities:WeatherCity[]}|{kind:'cancelled'};
