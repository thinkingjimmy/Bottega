/**
 * [INPUT]: Only this locale definition labels.
 * [OUTPUT]: The complete weatherEs Weather copy object.
 * [POS]: Deferred locale data; no other locale or aggregate dependency.
 */
import {weatherEsDefinition} from '../definitions/es';
export const weatherEs={
  ...weatherEsDefinition,
  "current": "Ubicación actual",
  "city": "Elegir ciudad",
  "search": "Buscar ciudad",
  "useCurrent": "Usar mi ubicación",
  "locating": "Buscando ubicación…",
  "located": "Ubicación encontrada",
  "noCities": "No se encontraron ciudades.",
  "chooseResult": "Elige una ciudad de los resultados.",
  "denied": "Se denegó la ubicación. Elige una ciudad o permite el acceso en Ajustes del Sistema.",
  "disabled": "La ubicación está desactivada. Elige una ciudad o actívala en Ajustes del Sistema.",
  "timeout": "La ubicación tardó demasiado. Reintenta o elige una ciudad.",
  "unavailable": "Ubicación no disponible. Elige una ciudad.",
  "authorization": "Permite la ubicación para usar tu posición actual.",
  "failed": "No se pudo cargar el tiempo. Reintenta.",
  "rateLimited": "El servicio está ocupado. Reintenta más tarde.",
  "invalid": "No se pudieron leer los datos del tiempo.",
  "searchFailed": "No se pudieron buscar ciudades. Reintenta.",
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
