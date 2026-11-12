/**
 * [INPUT]: Only this locale definition labels.
 * [OUTPUT]: The complete weatherEs Weather copy for city selection, previews and forecasts.
 * [POS]: Deferred locale data; no other locale or aggregate dependency.
 */
import {weatherEsDefinition} from '../definitions/es';
export const weatherEs={
  ...weatherEsDefinition,
  "city": "Ciudad",
  "search": "Buscar una ciudad",
  "searching": "Buscando…",
  "changeCity": "Cambiar de ciudad",
  "cancelCityChange": "Cancelar el cambio",
  "noCities": "No se encontraron ciudades.",
  "today": "Hoy",
  "dailyRange": "Máxima {{high}} °C, mínima {{low}} °C",
  "forecastUnavailable": "Sin pronóstico",
  "sizeCurrent": "Condiciones actuales",
  "sizeToday": "Condiciones actuales y máxima y mínima de hoy",
  "sizeForecast": "Condiciones actuales y pronóstico de los próximos tres días",
  "failed": "No se pudo cargar el tiempo. Reintenta.",
  "rateLimited": "El servicio está ocupado. Reintenta más tarde.",
  "invalid": "No se pudieron leer los datos del tiempo.",
  "searchFailed": "No se pudieron buscar ciudades.",
  "temperature": "Temperatura",
  "feelsLike": "Sensación térmica",
  "humidity": "Humedad",
  "condition": "Condiciones",
  "observedAt": "Observado a las",
  "attribution": "Datos del tiempo: Open-Meteo",
  "clear": "Despejado",
  "partlyCloudy": "Parcialmente nublado",
  "cloudy": "Nublado",
  "fog": "Niebla",
  "drizzle": "Llovizna",
  "rain": "Lluvia",
  "snow": "Nieve",
  "showers": "Chubascos",
  "thunderstorm": "Tormenta",
  "unknown": "Desconocido",
  "usage": "Open-Meteo se usa con fines personales y no comerciales.",
  "refresh": "Actualizar"
};
