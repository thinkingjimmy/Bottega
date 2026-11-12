/**
 * [INPUT]: The fixed Dock size vocabulary and normalized weather codes and dates.
 * [OUTPUT]: WeatherFaceReading, bounded forecast length and shared day and condition formatting.
 * [POS]: Pure Weather presentation data shared by Main, the native face and settings previews.
 */
import type { DockSummarySize } from '@bottega/contracts/plugins/dock/geometry';

export const WEATHER_FORECAST_DAYS = 4;

export type WeatherDay = { date: string; code: number; high: number; low: number };
export type WeatherFaceReading = {
  city: string;
  temperature: number;
  code: number;
  today: WeatherDay | null;
  upcoming: WeatherDay[];
};

export function weatherDaysForSize(reading: WeatherFaceReading, size: DockSummarySize) {
  if (size === 'large') return reading.upcoming;
  return size === 'medium' && reading.today ? [reading.today] : [];
}

export function weatherWeekday(date: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(new Date(date));
}

export function weatherConditionKey(code: number) {
  if (code === 0) return 'clear';
  if (code <= 2) return 'partlyCloudy';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if (code >= 61 && code <= 67) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 80 && code <= 82) return 'showers';
  if (code >= 95) return 'thunderstorm';
  return 'unknown';
}
