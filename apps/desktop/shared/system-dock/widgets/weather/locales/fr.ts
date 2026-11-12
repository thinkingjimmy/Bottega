/**
 * [INPUT]: Only this locale definition labels.
 * [OUTPUT]: The complete weatherFr Weather copy for city selection, previews and forecasts.
 * [POS]: Deferred locale data; no other locale or aggregate dependency.
 */
import {weatherFrDefinition} from '../definitions/fr';
export const weatherFr={
  ...weatherFrDefinition,
  "city": "Ville",
  "search": "Rechercher une ville",
  "searching": "Recherche…",
  "addWithoutCity": "Ajouter sans ville",
  "changeCity": "Changer de ville",
  "cancelCityChange": "Annuler le changement",
  "noCities": "Aucune ville trouvée.",
  "today": "Aujourd’hui",
  "dailyRange": "Max. {{high}} °C, min. {{low}} °C",
  "forecastUnavailable": "Pas de prévision",
  "sizeCurrent": "Conditions actuelles",
  "sizeToday": "Conditions actuelles et températures du jour",
  "sizeForecast": "Conditions actuelles et prévisions des trois prochains jours",
  "failed": "Impossible de charger la météo. Réessayez.",
  "rateLimited": "Le service météo est occupé. Réessayez plus tard.",
  "invalid": "Les données météo sont illisibles.",
  "searchFailed": "Impossible de rechercher des villes.",
  "temperature": "Température",
  "feelsLike": "Ressenti",
  "humidity": "Humidité",
  "condition": "Conditions",
  "observedAt": "Observation",
  "attribution": "Données météo: Open-Meteo",
  "clear": "Ciel dégagé",
  "partlyCloudy": "Partiellement nuageux",
  "cloudy": "Nuageux",
  "fog": "Brouillard",
  "drizzle": "Bruine",
  "rain": "Pluie",
  "snow": "Neige",
  "showers": "Averses",
  "thunderstorm": "Orage",
  "unknown": "Inconnu",
  "usage": "Open-Meteo est utilisé à des fins personnelles et non commerciales.",
  "refresh": "Actualiser"
};
