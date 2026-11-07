/**
 * [INPUT]: Only this locale definition labels.
 * [OUTPUT]: The complete weatherFr Weather copy object; the unused city-result instruction is excluded.
 * [POS]: Deferred locale data; no other locale or aggregate dependency.
 */
import {weatherFrDefinition} from '../definitions/fr';
export const weatherFr={
  ...weatherFrDefinition,
  "current": "Position actuelle",
  "city": "Choisir une ville",
  "search": "Rechercher une ville",
  "useCurrent": "Utiliser ma position",
  "locating": "Localisation…",
  "located": "Position trouvée",
  "noCities": "Aucune ville trouvée.",
  "denied": "Accès à la position refusé. Choisissez une ville ou autorisez cet accès dans les réglages système.",
  "disabled": "La localisation est désactivée. Choisissez une ville ou activez-la dans les réglages système.",
  "timeout": "La localisation a expiré. Réessayez ou choisissez une ville.",
  "unavailable": "Position indisponible. Choisissez une ville.",
  "authorization": "Autorisez la localisation pour utiliser votre position.",
  "failed": "Impossible de charger la météo. Réessayez.",
  "rateLimited": "Le service météo est occupé. Réessayez plus tard.",
  "invalid": "Les données météo sont illisibles.",
  "searchFailed": "Impossible de rechercher des villes. Réessayez.",
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
