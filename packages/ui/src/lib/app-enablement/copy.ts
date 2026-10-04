/**
 * [INPUT]: Depends on the shared locale resolver.
 * [OUTPUT]: Provides five-language App enablement copy, a missing Chat title fallback and named failure rendering.
 * [POS]: Shared desktop, Web and phone copy for the approved App close/reopen flow.
 */
import { resolveAppLocale } from "../locale";
const tables = {
  "en": {
    "chatFallback": "Chat",
    "moreRunning": "And {count} more.",
    "closeMenu": "Close App…",
    "open": "Open App",
    "closed": "Closed",
    "title": "Close “{app}”?",
    "windows": "Close open App windows.",
    "running": "Running tasks to stop: {count}.",
    "queued": "Queued messages kept: {count}. They will resume when the App is reopened.",
    "retained": "App data and Base are kept.",
    "cancel": "Cancel",
    "confirm": "Close App",
    "closing": "Closing…",
    "closedBody": "This App is closed. Its data and Base are still available.",
    "offline": "The computer is offline.",
    "waiting": "Waiting for the computer…",
    "stale": "The App or its running tasks changed. Review the updated impact before closing.",
    "transitioning": "The App is busy. Try again when its current operation finishes.",
    "failed": "Could not change the App. Try again.",
    "loading": "Checking App status…"
  },
  "zh-CN": {
    "chatFallback": "Chat",
    "moreRunning": "另有 {count} 个任务。",
    "closeMenu": "关闭 App…",
    "open": "打开 App",
    "closed": "已关闭",
    "title": "关闭「{app}」？",
    "windows": "关闭已打开的 App 界面。",
    "running": "停止 {count} 个正在运行的任务。",
    "queued": "保留 {count} 条排队消息，重新打开后继续发送。",
    "retained": "App 数据与 Base 保留。",
    "cancel": "取消",
    "confirm": "关闭 App",
    "closing": "正在关闭…",
    "closedBody": "此 App 已关闭。数据与 Base 仍可使用。",
    "offline": "电脑离线。",
    "waiting": "等待电脑处理…",
    "stale": "App 或运行中的任务发生了变化，请确认更新后的影响。",
    "transitioning": "App 正在处理其他操作，请完成后重试。",
    "failed": "未能更改 App，请重试。",
    "loading": "正在读取 App 状态…"
  },
  "ja": {
    "chatFallback": "Chat",
    "moreRunning": "ほか {count} 件。",
    "closeMenu": "App を閉じる…",
    "open": "App を開く",
    "closed": "閉じています",
    "title": "「{app}」を閉じますか？",
    "windows": "開いている App の画面を閉じます。",
    "running": "停止する実行中のタスク：{count}。",
    "queued": "待機中のメッセージ {count} 件は保持され、再度開くと送信されます。",
    "retained": "App のデータと Base は保持されます。",
    "cancel": "キャンセル",
    "confirm": "App を閉じる",
    "closing": "閉じています…",
    "closedBody": "この App は閉じています。データと Base は引き続き使用できます。",
    "offline": "コンピューターがオフラインです。",
    "waiting": "コンピューターの処理を待っています…",
    "stale": "App または実行中のタスクが変わりました。更新された影響を確認してください。",
    "transitioning": "App は処理中です。現在の操作が完了したら再試行してください。",
    "failed": "App を変更できませんでした。再試行してください。",
    "loading": "App の状態を確認しています…"
  },
  "es": {
    "chatFallback": "Chat",
    "moreRunning": "Y {count} más.",
    "closeMenu": "Cerrar App…",
    "open": "Abrir App",
    "closed": "Cerrada",
    "title": "¿Cerrar «{app}»?",
    "windows": "Cerrar las ventanas abiertas de la App.",
    "running": "Tareas activas que se detendrán: {count}.",
    "queued": "Se conservarán {count} mensajes en espera y se enviarán al volver a abrir la App.",
    "retained": "Se conservan los datos de la App y la Base.",
    "cancel": "Cancelar",
    "confirm": "Cerrar App",
    "closing": "Cerrando…",
    "closedBody": "Esta App está cerrada. Sus datos y su Base siguen disponibles.",
    "offline": "El ordenador está desconectado.",
    "waiting": "Esperando al ordenador…",
    "stale": "La App o sus tareas cambiaron. Revisa el impacto actualizado antes de cerrar.",
    "transitioning": "La App está ocupada. Inténtalo cuando termine la operación actual.",
    "failed": "No se pudo cambiar la App. Inténtalo de nuevo.",
    "loading": "Comprobando el estado de la App…"
  },
  "fr": {
    "chatFallback": "Chat",
    "moreRunning": "Et {count} autres.",
    "closeMenu": "Fermer l’App…",
    "open": "Ouvrir l’App",
    "closed": "Fermée",
    "title": "Fermer « {app} » ?",
    "windows": "Fermer les fenêtres ouvertes de l’App.",
    "running": "Tâches en cours à arrêter : {count}.",
    "queued": "Les {count} messages en attente sont conservés et seront envoyés à la réouverture.",
    "retained": "Les données de l’App et la Base sont conservées.",
    "cancel": "Annuler",
    "confirm": "Fermer l’App",
    "closing": "Fermeture…",
    "closedBody": "Cette App est fermée. Ses données et sa Base restent disponibles.",
    "offline": "L’ordinateur est hors ligne.",
    "waiting": "En attente de l’ordinateur…",
    "stale": "L’App ou ses tâches ont changé. Vérifiez les conséquences mises à jour avant de fermer.",
    "transitioning": "L’App est occupée. Réessayez une fois l’opération en cours terminée.",
    "failed": "Impossible de modifier l’App. Réessayez.",
    "loading": "Vérification de l’état de l’App…"
  }
} as const;
export const appEnablementCopy = (locale: string) => tables[resolveAppLocale(locale)];
export const enablementLine = (line: string, values: Record<string, string | number>) => line.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
export function appEnablementError(error: unknown, locale: string) {
  const message = error instanceof Error ? error.message : String(error), copy = appEnablementCopy(locale);
  if (message.includes("app-enablement-stale")) return copy.stale;
  if (message.includes("app-transitioning")) return copy.transitioning;
  if (message.includes("app-disabled")) return copy.closedBody;
  if (message.includes("remote-offline")) return copy.offline;
  return copy.failed;
}
