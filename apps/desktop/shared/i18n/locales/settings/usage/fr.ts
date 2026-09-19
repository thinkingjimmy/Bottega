/**
 * [INPUT]: Depends on the settingsUsageEn structural type and usageLimitsFr from ../usage-limits
 * [OUTPUT]: Provides settingsUsageFr, the French Settings › Usage catalog
 * [POS]: French leaf of shared/i18n/locales/settings/usage; loaded on demand by the matching top-level locale
 */

import type { settingsUsageEn } from "./en";
import { usageLimitsFr } from "../usage-limits";

export const settingsUsageFr: typeof settingsUsageEn = {
  limits: usageLimitsFr,
  today: "Aujourd’hui",
  allTime: "Depuis le début",
  rawTokenCost: "Coût brut des tokens",
  rawTokenCostNote: "Si facturé au tarif public de l’API",
  metric: "Indicateur d’utilisation",
  metricCost: "Coût",
  metricTokens: "Tokens",
  dailyChart: "Totaux quotidiens des {{days}} derniers jours",
  shareOfToday: "{{percent}} du total du jour ({{total}}), toutes sources confondues",
  loading: "Chargement de l’utilisation",
  readFailed: "Impossible de lire l’utilisation locale des tokens. Réessayez.",
  noDataTitle: "Aucune donnée d’utilisation locale",
  noDataDetail: "Démarrez une conversation avec le CLI correspondant, puis actualisez cette page.",
  pricingTitle: "Tarification estimée",
  pricingRefresh: "Actualiser automatiquement les prix estimés",
  pricingRefreshDescription:
    "À l’ouverture de cette page, vérifier les prix models.dev selon un cache de 24 heures. Si désactivé, utiliser uniquement le seed local et le cache existant.",
  pricingRefreshAria: "Actualiser automatiquement les prix estimés d’utilisation",
  pricingRefreshSaveFailed: "Impossible d’enregistrer le réglage d’actualisation des prix",
  refresh: "Actualiser l’utilisation",
  source: "Source d’utilisation",
  all: "Toutes",
  tokenActivity: "Activité des tokens",
  intensity: "Intensité de l’activité des tokens",
  less: "Moins",
  more: "Plus",
  level: "Niveau {{level}}",
  dailyTotals: "Totaux quotidiens en {{timeZone}}",
  dailyGrid: "Activité quotidienne des tokens sur les 53 dernières semaines",
  cellLabel: "{{date}} : {{tokens}} tokens · {{cost}}",
  costNote:
    "Les coûts convertissent l’utilisation locale de l’abonnement avec les prix API publics actuels de models.dev. Ce n’est pas une facture, mais une estimation approximative en USD de la consommation de tokens.",
};
