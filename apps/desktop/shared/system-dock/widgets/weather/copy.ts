/**
 * [INPUT]: Independent Weather locale leaves, normalized readings and the pure error-key mapper.
 * [OUTPUT]: Five-locale copy, English fallback, accessible size descriptions and localized failures.
 * [POS]: Main aggregate; renderer consumers use loaded Dock catalogs.
 */
import {weatherFailureKey} from './errors';
import {weatherEn} from './locales/en';
import {weatherZhCN} from './locales/zh-cn';
import {weatherJa} from './locales/ja';
import {weatherFr} from './locales/fr';
import {weatherEs} from './locales/es';
import type { DockSummarySize } from '@bottega/contracts/plugins/dock/geometry';
import { weatherConditionKey, weatherDaysForSize, weatherWeekday, type WeatherFaceReading } from './forecast';
export const weatherTranslations={"en":weatherEn,"zh-CN":weatherZhCN,"ja":weatherJa,"fr":weatherFr,"es":weatherEs};
export function weatherCopy(locale:string){return weatherTranslations[locale as keyof typeof weatherTranslations]??weatherTranslations.en;}
export function weatherFailure(locale:string,error:unknown){return weatherCopy(locale)[weatherFailureKey(error)];}

export function describeWeather(reading: WeatherFaceReading, size: DockSummarySize, locale: string): string {
  const copy = weatherCopy(locale);
  const current = `${Math.round(reading.temperature)}°C, ${copy[weatherConditionKey(reading.code)]}`;
  const days = weatherDaysForSize(reading, size);
  if (size === 'small') return current;
  if (!days.length) return `${current}, ${copy.forecastUnavailable}`;
  const forecast = days.map(day => {
    const name = size === 'medium' ? copy.today : weatherWeekday(day.date, locale);
    const range = copy.dailyRange.replace('{{high}}', String(Math.round(day.high))).replace('{{low}}', String(Math.round(day.low)));
    return `${name}, ${copy[weatherConditionKey(day.code)]}, ${range}`;
  });
  return [current, ...forecast].join(', ');
}
