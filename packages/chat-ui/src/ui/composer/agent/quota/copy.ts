/**
 * [INPUT]: No runtime dependencies; five matching quota presentation catalogs.
 * [OUTPUT]: Localized quota details, calendar-month periods and compact summaries with unavailable, unsupported and deferred states.
 * [POS]: The Agent surface's quota vocabulary; native pool and plan labels remain provider-owned.
 */
export const usageLimitsEn = {
  cachedSource: "Reported limits may be cached",
  fiveHour: "5-hour usage limit",
  monthly: "Monthly usage limit", month: "Month",
  title: "Usage limits", history: "Usage history", agent: "Agent",
  note: "Account limits may include usage from other clients. Times in {{timeZone}}.",
  scope: "Default accounts", customProvider: "This conversation uses a different provider. Default account limits may not apply.",
  details: "Usage details", general: "General limits", weekly: "Weekly usage limit", week: "Week", period: "Limit", window: "{{duration}} usage limit",
  left: "{{percent}} left", resets: "Resets {{date}}", checked: "Checked {{date}}", timeZone: "Times in {{timeZone}}",
  resetUnknown: "Reset time unavailable", resetPending: "Confirming the reset", resetEnded: "Previous window ended; reset time has not updated",
  previousReset: "Previous reset: {{date}}", previousValue: "Last recorded: {{percent}} left", loading: "Fetching limits",
  busy: "Agent in use; limits will update when idle", notInstalled: "Not installed", signIn: "Sign in to view limits",
  unsupported: "Limits unavailable for this version or account", unavailable: "Could not fetch limits", stale: "Showing the last checked limits",
  manage: "Agent settings", refresh: "Refresh {{agent}} limits", low: "Low remaining limit", exhausted: "This limit is exhausted",
  noWindows: "No limits were provided", unknown: "Limit unavailable",
  summaryUnsupported: "Limits not supported", summaryUnavailable: "Limits unavailable",
  summaryStale: "Awaiting updated limits", summaryDeferred: "Updates when idle", summaryCustomProvider: "Custom provider",
};
type Catalog = typeof usageLimitsEn;
export const usageLimitsZhCN: Catalog = {
  cachedSource: "额度数据可能来自缓存",
  fiveHour: "5 小时额度",
  monthly: "每月额度", month: "月",
  title: "使用额度", history: "使用历史", agent: "Agent",
  note: "账号额度可能包含其他客户端的使用量。时间按 {{timeZone}} 显示。",
  scope: "默认账号", customProvider: "此对话使用其他服务商，默认账号额度可能不适用。",
  details: "额度详情", general: "通用额度", weekly: "每周额度", week: "周", period: "额度", window: "{{duration}}额度",
  left: "剩余 {{percent}}", resets: "重置于 {{date}}", checked: "查询于 {{date}}", timeZone: "时间按 {{timeZone}} 显示",
  resetUnknown: "重置时间暂不可用", resetPending: "正在确认重置状态", resetEnded: "上个窗口已结束，重置时间尚未更新",
  previousReset: "上次重置时间：{{date}}", previousValue: "上次记录：剩余 {{percent}}", loading: "正在获取额度",
  busy: "Agent 使用中，稍后更新", notInstalled: "尚未安装", signIn: "登录后可查看额度",
  unsupported: "当前版本或账号暂不支持查询额度", unavailable: "暂时无法获取额度", stale: "正在显示上次查询记录",
  manage: "Agent 设置", refresh: "刷新 {{agent}} 额度", low: "剩余额度较低", exhausted: "此额度已耗尽",
  noWindows: "暂未提供额度窗口", unknown: "额度数据暂不可用",
  summaryUnsupported: "暂不支持额度查询", summaryUnavailable: "额度暂不可用",
  summaryStale: "等待更新额度", summaryDeferred: "空闲后更新额度", summaryCustomProvider: "使用其他服务商",
};
export const usageLimitsJa: Catalog = {
  cachedSource: "上限データはキャッシュされている場合があります",
  fiveHour: "5時間の利用上限",
  monthly: "月間利用上限", month: "月",
  title: "利用上限", history: "利用履歴", agent: "Agent",
  note: "アカウントの上限には他のクライアントでの利用も含まれる場合があります。表示時刻：{{timeZone}}。",
  scope: "既定のアカウント", customProvider: "この会話は別のプロバイダーを使用しています。既定のアカウントの上限が適用されない場合があります。",
  details: "利用の詳細", general: "共通の上限", weekly: "週間利用上限", week: "週", period: "上限", window: "{{duration}}の利用上限",
  left: "残り {{percent}}", resets: "リセット：{{date}}", checked: "確認：{{date}}", timeZone: "表示時刻：{{timeZone}}",
  resetUnknown: "リセット時刻を取得できません", resetPending: "リセット状況を確認中", resetEnded: "前の期間は終了しました。リセット時刻は未更新です",
  previousReset: "前回のリセット：{{date}}", previousValue: "前回の記録：残り {{percent}}", loading: "上限を取得中",
  busy: "Agent の利用終了後に更新します", notInstalled: "未インストール", signIn: "ログインして上限を確認",
  unsupported: "このバージョンまたはアカウントでは上限を取得できません", unavailable: "上限を取得できませんでした", stale: "前回確認した上限を表示中",
  manage: "Agent の設定", refresh: "{{agent}} の上限を更新", low: "残りの利用枠が少なくなっています", exhausted: "この利用枠を使い切りました",
  noWindows: "利用期間の情報がありません", unknown: "上限を取得できません",
  summaryUnsupported: "上限の取得に未対応", summaryUnavailable: "上限を取得できません",
  summaryStale: "上限の更新待ち", summaryDeferred: "利用終了後に更新", summaryCustomProvider: "別のプロバイダーを使用中",
};
export const usageLimitsFr: Catalog = {
  cachedSource: "Les limites indiquées peuvent provenir du cache",
  fiveHour: "Limite sur 5 heures",
  monthly: "Limite mensuelle", month: "Mois",
  title: "Limites d’utilisation", history: "Historique d’utilisation", agent: "Agent",
  note: "Les limites du compte peuvent inclure l’utilisation d’autres clients. Heures en {{timeZone}}.",
  scope: "Comptes par défaut", customProvider: "Cette conversation utilise un autre fournisseur. Les limites du compte par défaut peuvent ne pas s’appliquer.",
  details: "Détails d’utilisation", general: "Limites générales", weekly: "Limite hebdomadaire", week: "Sem.", period: "Limite", window: "Limite sur {{duration}}",
  left: "{{percent}} restants", resets: "Réinitialisation le {{date}}", checked: "Vérifié le {{date}}", timeZone: "Heures en {{timeZone}}",
  resetUnknown: "Date de réinitialisation indisponible", resetPending: "Vérification de la réinitialisation", resetEnded: "La période précédente est terminée ; la date de réinitialisation n’a pas été actualisée",
  previousReset: "Réinitialisation précédente : {{date}}", previousValue: "Dernier relevé : {{percent}} restants", loading: "Chargement des limites",
  busy: "Agent en cours d’utilisation ; actualisation à la fin", notInstalled: "Non installé", signIn: "Connectez-vous pour voir les limites",
  unsupported: "Limites indisponibles pour cette version ou ce compte", unavailable: "Impossible de récupérer les limites", stale: "Affichage des dernières limites vérifiées",
  manage: "Réglages des Agents", refresh: "Actualiser les limites de {{agent}}", low: "Limite restante faible", exhausted: "Cette limite est atteinte",
  noWindows: "Aucune période fournie", unknown: "Limite indisponible",
  summaryUnsupported: "Limites non prises en charge", summaryUnavailable: "Limites indisponibles",
  summaryStale: "Limites en attente de mise à jour", summaryDeferred: "Mise à jour après utilisation", summaryCustomProvider: "Autre fournisseur",
};
export const usageLimitsEs: Catalog = {
  cachedSource: "Los límites indicados pueden proceder de la caché",
  fiveHour: "Límite de 5 horas",
  monthly: "Límite mensual", month: "Mes",
  title: "Límites de uso", history: "Historial de uso", agent: "Agent",
  note: "Los límites de la cuenta pueden incluir el uso de otros clientes. Horas en {{timeZone}}.",
  scope: "Cuentas predeterminadas", customProvider: "Esta conversación usa otro proveedor. Puede que los límites de la cuenta predeterminada no se apliquen.",
  details: "Detalles de uso", general: "Límites generales", weekly: "Límite semanal", week: "Sem.", period: "Límite", window: "Límite de {{duration}}",
  left: "{{percent}} restante", resets: "Se restablece el {{date}}", checked: "Consultado el {{date}}", timeZone: "Horas en {{timeZone}}",
  resetUnknown: "Hora de restablecimiento no disponible", resetPending: "Confirmando el restablecimiento", resetEnded: "El periodo anterior ha terminado; la hora de restablecimiento no se ha actualizado",
  previousReset: "Restablecimiento anterior: {{date}}", previousValue: "Último registro: {{percent}} restante", loading: "Consultando límites",
  busy: "Agent en uso; se actualizará cuando termine", notInstalled: "No instalado", signIn: "Inicia sesión para ver los límites",
  unsupported: "Límites no disponibles para esta versión o cuenta", unavailable: "No se pudieron consultar los límites", stale: "Mostrando los últimos límites consultados",
  manage: "Ajustes de Agents", refresh: "Actualizar límites de {{agent}}", low: "Queda poco uso disponible", exhausted: "Se ha agotado este límite",
  noWindows: "No se proporcionaron periodos", unknown: "Límite no disponible",
  summaryUnsupported: "Consulta de límites no compatible", summaryUnavailable: "Límites no disponibles",
  summaryStale: "Esperando límites actualizados", summaryDeferred: "Se actualiza al terminar", summaryCustomProvider: "Otro proveedor",
};

const catalogs: Record<string, typeof usageLimitsEn> = { en: usageLimitsEn, zh: usageLimitsZhCN, ja: usageLimitsJa, fr: usageLimitsFr, es: usageLimitsEs };
export function quotaTranslate(locale: string) {
  const copy = catalogs[locale.toLowerCase().split("-")[0]!] ?? usageLimitsEn;
  return (key: string, values: Record<string, unknown> = {}) => (copy[key.replace("settings.usage.limits.", "") as keyof typeof copy] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name] ?? ""));
}
