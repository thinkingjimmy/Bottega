/**
 * [INPUT]: The host presentation locale.
 * [OUTPUT]: Five-language loading, recovery and content-area connection vocabulary.
 * [POS]: Small feedback catalog for admission and workspace chrome; computer-specific guidance loads with Chat.
 */
const en = {
    loading: "Loading…",
    failed: "Unable to load",
    tryLater: "Please try again later.",
    retry: "Retry",
    details: "Details",
    close: "Close",
    disconnected: "Connection interrupted",
    partial: "Some content has not synced yet. You can still send messages.",
    query: "Check status",
};
type Copy = { [K in keyof typeof en]: string };
const copies: Record<string, Copy> = {
  en,
  zh: {
    loading: "正在加载…",
    failed: "暂时无法加载",
    tryLater: "请稍后重试。",
    retry: "重试",
    details: "详情",
    close: "关闭",
    disconnected: "连接已中断",
    partial: "部分内容尚未同步，仍可发送消息。",
    query: "查询状态",
  },
  ja: {
    loading: "読み込み中…",
    failed: "読み込めません",
    tryLater: "しばらくしてからもう一度お試しください。",
    retry: "再試行",
    details: "詳細",
    close: "閉じる",
    disconnected: "接続が切れました",
    partial: "一部の内容は未同期です。メッセージは送信できます。",
    query: "状態を確認",
  },
  fr: {
    loading: "Chargement…",
    failed: "Chargement impossible",
    tryLater: "Veuillez réessayer plus tard.",
    retry: "Réessayer",
    details: "Détails",
    close: "Fermer",
    disconnected: "Connexion interrompue",
    partial: "Une partie du contenu n’est pas synchronisée. Vous pouvez envoyer des messages.",
    query: "Vérifier l’état",
  },
  es: {
    loading: "Cargando…",
    failed: "No se puede cargar",
    tryLater: "Inténtalo de nuevo más tarde.",
    retry: "Reintentar",
    details: "Detalles",
    close: "Cerrar",
    disconnected: "Conexión interrumpida",
    partial: "Parte del contenido aún no se ha sincronizado. Puedes enviar mensajes.",
    query: "Consultar estado",
  },
};
export const connectionCopy = (locale: string): Copy => copies[locale.toLowerCase().split("-")[0]!] ?? en;
