/**
 * [INPUT]: No runtime dependencies; five matching quota presentation catalogs.
 * [OUTPUT]: Localized quota details, calendar-month periods and compact summaries with unavailable, unsupported (and Claude's custom-route recovery) and deferred states; a renewed window's past reset, never words for a stale reading (its Checked time says its age).
 * [POS]: The Agent surface's quota vocabulary; native pool and plan labels remain provider-owned.
 */
export const usageLimitsEn = {
  fiveHour: "5-hour usage limit",
  monthly: "Monthly usage limit", month: "Month",
  title: "Usage limits", history: "Usage history", agent: "Agent",
  note: "Account limits may include usage from other clients. Times in {{timeZone}}.",
  scope: "Default account", customProvider: "This conversation uses a different provider. Default account limits may not apply.",
  details: "Usage details", general: "General limits", weekly: "Weekly usage limit", week: "Week", period: "Limit", window: "{{duration}} usage limit",
  left: "{{percent}} left", resets: "Resets {{date}}", resetDone: "Reset {{date}}", checked: "Checked {{date}}", timeZone: "Times in {{timeZone}}",
  loading: "Fetching limits",
  busy: "Agent in use; limits will update when idle", notInstalled: "Not installed", signIn: "Sign in to view limits",
  claudeCustomRoute: "Claude is connected through a custom endpoint or API key, which has no subscription limits to show. To see them, remove the custom endpoint settings (such as ANTHROPIC_BASE_URL) from settings.json, then refresh.",
  showRouteConfig: "Show settings.json", showRouteConfigFailed: "Couldn’t open the folder containing settings.json",
  unsupported: "Limits unavailable for this version or account", unavailable: "Could not fetch limits",
  manage: "Agent settings", refresh: "Refresh {{agent}} limits", low: "Low remaining limit", exhausted: "This limit is exhausted",
  noWindows: "No limits were provided", unknown: "Limit unavailable",
  summaryUnsupported: "Limits not supported", summaryUnavailable: "Limits unavailable",
  summaryDeferred: "Updates when idle", summaryCustomProvider: "Custom provider",
};
type Catalog = typeof usageLimitsEn;
export const usageLimitsZhCN: Catalog = {
  fiveHour: "5 小时额度",
  monthly: "每月额度", month: "月",
  title: "使用额度", history: "使用历史", agent: "Agent",
  note: "账号额度可能包含其他客户端的使用量。时间按 {{timeZone}} 显示。",
  scope: "默认账号", customProvider: "此对话使用其他服务商，默认账号额度可能不适用。",
  details: "额度详情", general: "通用额度", weekly: "每周额度", week: "周", period: "额度", window: "{{duration}}额度",
  left: "剩余 {{percent}}", resets: "重置于 {{date}}", resetDone: "已于 {{date}} 重置", checked: "查询于 {{date}}", timeZone: "时间按 {{timeZone}} 显示",
  loading: "正在获取额度",
  busy: "Agent 使用中，稍后更新", notInstalled: "尚未安装", signIn: "登录后可查看额度",
  claudeCustomRoute: "Claude 正通过自定义接口或 API Key 连接，没有订阅额度可显示。如需查看，请删除 settings.json 中的自定义接口配置（如 ANTHROPIC_BASE_URL），然后刷新。",
  showRouteConfig: "显示 settings.json", showRouteConfigFailed: "无法打开 settings.json 所在文件夹",
  unsupported: "当前版本或账号暂不支持查询额度", unavailable: "暂时无法获取额度",
  manage: "Agent 设置", refresh: "刷新 {{agent}} 额度", low: "剩余额度较低", exhausted: "此额度已耗尽",
  noWindows: "暂未提供额度窗口", unknown: "额度数据暂不可用",
  summaryUnsupported: "暂不支持额度查询", summaryUnavailable: "额度暂不可用",
  summaryDeferred: "空闲后更新额度", summaryCustomProvider: "使用其他服务商",
};
export const usageLimitsJa: Catalog = {
  fiveHour: "5時間の利用上限",
  monthly: "月間利用上限", month: "月",
  title: "利用上限", history: "利用履歴", agent: "Agent",
  note: "アカウントの上限には他のクライアントでの利用も含まれる場合があります。表示時刻：{{timeZone}}。",
  scope: "既定のアカウント", customProvider: "この会話は別のプロバイダーを使用しています。既定のアカウントの上限が適用されない場合があります。",
  details: "利用の詳細", general: "共通の上限", weekly: "週間利用上限", week: "週", period: "上限", window: "{{duration}}の利用上限",
  left: "残り {{percent}}", resets: "リセット：{{date}}", resetDone: "リセット済み：{{date}}", checked: "確認：{{date}}", timeZone: "表示時刻：{{timeZone}}",
  loading: "上限を取得中",
  busy: "Agent の利用終了後に更新します", notInstalled: "未インストール", signIn: "ログインして上限を確認",
  claudeCustomRoute: "Claude はカスタムエンドポイントまたは API キーで接続されているため、表示できるサブスクリプションの上限がありません。確認するには、settings.json からカスタムエンドポイントの設定（ANTHROPIC_BASE_URL など）を削除してから更新してください。",
  showRouteConfig: "settings.json を表示", showRouteConfigFailed: "settings.json のあるフォルダを開けませんでした",
  unsupported: "このバージョンまたはアカウントでは上限を取得できません", unavailable: "上限を取得できませんでした",
  manage: "Agent の設定", refresh: "{{agent}} の上限を更新", low: "残りの利用枠が少なくなっています", exhausted: "この利用枠を使い切りました",
  noWindows: "利用期間の情報がありません", unknown: "上限を取得できません",
  summaryUnsupported: "上限の取得に未対応", summaryUnavailable: "上限を取得できません",
  summaryDeferred: "利用終了後に更新", summaryCustomProvider: "別のプロバイダーを使用中",
};
export const usageLimitsFr: Catalog = {
  fiveHour: "Limite sur 5 heures",
  monthly: "Limite mensuelle", month: "Mois",
  title: "Limites d’utilisation", history: "Historique d’utilisation", agent: "Agent",
  note: "Les limites du compte peuvent inclure l’utilisation d’autres clients. Heures en {{timeZone}}.",
  scope: "Compte par défaut", customProvider: "Cette conversation utilise un autre fournisseur. Les limites du compte par défaut peuvent ne pas s’appliquer.",
  details: "Détails d’utilisation", general: "Limites générales", weekly: "Limite hebdomadaire", week: "Sem.", period: "Limite", window: "Limite sur {{duration}}",
  left: "Reste {{percent}}", resets: "Réinitialisation : {{date}}", resetDone: "Réinitialisé : {{date}}", checked: "Vérifié : {{date}}", timeZone: "Heures en {{timeZone}}",
  loading: "Chargement des limites",
  busy: "Agent en cours d’utilisation ; actualisation à la fin", notInstalled: "Non installé", signIn: "Connectez-vous pour voir les limites",
  claudeCustomRoute: "Claude est connecté via un point de terminaison personnalisé ou une clé API, qui n’a pas de limites d’abonnement à afficher. Pour les voir, supprimez les réglages de point de terminaison personnalisé (comme ANTHROPIC_BASE_URL) de settings.json, puis actualisez.",
  showRouteConfig: "Afficher settings.json", showRouteConfigFailed: "Impossible d’ouvrir le dossier contenant settings.json",
  unsupported: "Limites indisponibles pour cette version ou ce compte", unavailable: "Impossible de récupérer les limites",
  manage: "Réglages des Agents", refresh: "Actualiser les limites de {{agent}}", low: "Limite restante faible", exhausted: "Cette limite est atteinte",
  noWindows: "Aucune période fournie", unknown: "Limite indisponible",
  summaryUnsupported: "Limites non prises en charge", summaryUnavailable: "Limites indisponibles",
  summaryDeferred: "Mise à jour après utilisation", summaryCustomProvider: "Autre fournisseur",
};
export const usageLimitsEs: Catalog = {
  fiveHour: "Límite de 5 horas",
  monthly: "Límite mensual", month: "Mes",
  title: "Límites de uso", history: "Historial de uso", agent: "Agent",
  note: "Los límites de la cuenta pueden incluir el uso de otros clientes. Horas en {{timeZone}}.",
  scope: "Cuenta predeterminada", customProvider: "Esta conversación usa otro proveedor. Puede que los límites de la cuenta predeterminada no se apliquen.",
  details: "Detalles de uso", general: "Límites generales", weekly: "Límite semanal", week: "Sem.", period: "Límite", window: "Límite de {{duration}}",
  left: "{{percent}} restante", resets: "Restablecimiento: {{date}}", resetDone: "Restablecido: {{date}}", checked: "Consultado: {{date}}", timeZone: "Horas en {{timeZone}}",
  loading: "Consultando límites",
  busy: "Agent en uso; se actualizará cuando termine", notInstalled: "No instalado", signIn: "Inicia sesión para ver los límites",
  claudeCustomRoute: "Claude está conectado mediante un endpoint personalizado o una clave de API, que no tiene límites de suscripción que mostrar. Para verlos, elimina los ajustes de endpoint personalizado (como ANTHROPIC_BASE_URL) de settings.json y actualiza.",
  showRouteConfig: "Mostrar settings.json", showRouteConfigFailed: "No se pudo abrir la carpeta de settings.json",
  unsupported: "Límites no disponibles para esta versión o cuenta", unavailable: "No se pudieron consultar los límites",
  manage: "Ajustes de Agents", refresh: "Actualizar límites de {{agent}}", low: "Queda poco uso disponible", exhausted: "Se ha agotado este límite",
  noWindows: "No se proporcionaron periodos", unknown: "Límite no disponible",
  summaryUnsupported: "Consulta de límites no compatible", summaryUnavailable: "Límites no disponibles",
  summaryDeferred: "Se actualiza al terminar", summaryCustomProvider: "Otro proveedor",
};

const catalogs: Record<string, typeof usageLimitsEn> = { en: usageLimitsEn, zh: usageLimitsZhCN, ja: usageLimitsJa, fr: usageLimitsFr, es: usageLimitsEs };
export function quotaTranslate(locale: string) {
  const copy = catalogs[locale.toLowerCase().split("-")[0]!] ?? usageLimitsEn;
  return (key: string, values: Record<string, unknown> = {}) => (copy[key.replace("settings.usage.limits.", "") as keyof typeof copy] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name] ?? ""));
}
