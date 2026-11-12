/**
 * [INPUT]: Only this locale definition labels.
 * [OUTPUT]: The complete weatherEn Weather copy for city selection, previews and forecasts.
 * [POS]: Deferred locale data; no other locale or aggregate dependency.
 */
import {weatherEnDefinition} from '../definitions/en';
export const weatherEn={
  ...weatherEnDefinition,
  "city": "City",
  "search": "Search for a city",
  "searching": "Searching…",
  "addWithoutCity": "Add without a city",
  "changeCity": "Change city",
  "cancelCityChange": "Cancel city change",
  "noCities": "No cities found.",
  "today": "Today",
  "dailyRange": "High {{high}}°C, low {{low}}°C",
  "forecastUnavailable": "No forecast",
  "sizeCurrent": "Current conditions",
  "sizeToday": "Current conditions and today’s high and low",
  "sizeForecast": "Current conditions and the next three days",
  "failed": "Could not load weather. Try again.",
  "rateLimited": "The weather service is busy. Try again later.",
  "invalid": "The weather response could not be read.",
  "searchFailed": "Could not search for cities.",
  "temperature": "Temperature",
  "feelsLike": "Feels like",
  "humidity": "Humidity",
  "condition": "Conditions",
  "observedAt": "Observed at",
  "attribution": "Weather data by Open-Meteo",
  "clear": "Clear",
  "partlyCloudy": "Partly cloudy",
  "cloudy": "Cloudy",
  "fog": "Fog",
  "drizzle": "Drizzle",
  "rain": "Rain",
  "snow": "Snow",
  "showers": "Showers",
  "thunderstorm": "Thunderstorm",
  "unknown": "Unknown",
  "usage": "Uses Open-Meteo for personal, non-commercial use.",
  "refresh": "Refresh"
};
