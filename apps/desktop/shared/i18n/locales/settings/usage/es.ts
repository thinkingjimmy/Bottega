/**
 * [INPUT]: Depends on the settingsUsageEn structural type and usageLimitsEs from ../usage-limits
 * [OUTPUT]: Provides settingsUsageEs, the Spanish Settings › Usage catalog
 * [POS]: Spanish leaf of shared/i18n/locales/settings/usage; loaded on demand by the matching top-level locale
 */

import type { settingsUsageEn } from "./en";
import { usageLimitsEs } from "../usage-limits";

export const settingsUsageEs: typeof settingsUsageEn = {
  limits: usageLimitsEs,
  today: "Hoy",
  allTime: "Histórico",
  rawTokenCost: "Coste bruto de tokens",
  rawTokenCostNote: "Si se facturara a precios de lista de la API",
  metric: "Métrica de uso",
  metricCost: "Coste",
  metricTokens: "Tokens",
  dailyChart: "Totales diarios de los últimos {{days}} días",
  shareOfToday: "{{percent}} del total de hoy ({{total}}) en todas las fuentes",
  loading: "Cargando el uso",
  readFailed: "No se pudo leer el uso local de tokens. Inténtalo de nuevo.",
  noDataTitle: "Aún no hay datos de uso local",
  noDataDetail: "Inicia una conversación con el CLI correspondiente y actualiza esta página.",
  pricingTitle: "Precios estimados",
  pricingRefresh: "Actualizar automáticamente los precios estimados",
  pricingRefreshDescription:
    "Al abrir esta página, comprobar los precios de models.dev con un ciclo de caché de 24 horas. Si se desactiva, usar solo el seed local y la caché existente.",
  pricingRefreshAria: "Actualizar automáticamente los precios estimados de Usage",
  pricingRefreshSaveFailed: "No se pudo guardar el ajuste de actualización de precios",
  refresh: "Actualizar uso",
  source: "Fuente de uso",
  all: "Todas",
  tokenActivity: "Actividad de tokens",
  intensity: "Intensidad de la actividad de tokens",
  less: "Menos",
  more: "Más",
  level: "Nivel {{level}}",
  dailyTotals: "Totales diarios en {{timeZone}}",
  dailyGrid: "Actividad diaria de tokens durante las últimas 53 semanas",
  cellLabel: "{{date}}: {{tokens}} tokens · {{cost}}",
  costNote:
    "Los costes convierten el uso local de la suscripción según los precios públicos actuales de API de models.dev. No son una factura, sino una estimación aproximada en USD del consumo de tokens.",
};
