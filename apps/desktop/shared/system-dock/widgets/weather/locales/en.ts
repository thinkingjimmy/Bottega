/**
 * [INPUT]: Only this locale definition labels.
 * [OUTPUT]: The complete weatherEn Weather copy object; the unused city-result instruction is excluded.
 * [POS]: Deferred locale data; no other locale or aggregate dependency.
 */
import {weatherEnDefinition} from '../definitions/en';
export const weatherEn={
  ...weatherEnDefinition,
  "current": "Current location",
  "city": "Choose a city",
  "search": "Search for a city",
  "useCurrent": "Use current location",
  "locating": "Finding your location…",
  "located": "Location ready",
  "noCities": "No cities found.",
  "denied": "Location access was denied. Choose a city or allow access in System Settings.",
  "disabled": "Location Services are off. Choose a city or turn them on in System Settings.",
  "timeout": "Location timed out. Try again or choose a city.",
  "unavailable": "System location is unavailable. Choose a city.",
  "authorization": "Allow location access to use your current location.",
  "failed": "Could not load weather. Try again.",
  "rateLimited": "The weather service is busy. Try again later.",
  "invalid": "The weather response could not be read.",
  "searchFailed": "Could not search for cities. Try again.",
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
