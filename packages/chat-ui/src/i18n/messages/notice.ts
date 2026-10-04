/**
 * [INPUT]: Depends on the shared locale resolver and workbench-copy's catalog-free formatCopy (Latin/CJK spacing).
 * [OUTPUT]: Provides remoteNoticeText: a transcript notice a remote viewer reads in its own language from the notice's kind and fields (U06-d's Localizes App-disabled notices for remote readers.
 *           declined extension: from which device, or nobody on the Chat's computer within 30 minutes), or null for a kind with no line here.
 * [POS]: packages/chat-ui/src/i18n/messages; chat-ui's remote counterpart of the desktop notice lines (approved 09-29); the stored English line is never what a viewer reads.
 */
import { resolveAppLocale } from "@ai-chat/ui/lib/locale";
import { formatCopy } from "@ai-chat/ui/lib/workbench-copy/format";
import type { ChatNotice } from "@ai-chat/cloud-protocol/chats/content/notices";

type Lines = { appDisabled: string; declinedRemote: string; declinedTimeout: string };
const en: Lines = {
  appDisabled: "This App is closed. Running tasks stopped; queued messages will resume when it is reopened.",
  declinedRemote: "Cancelled from {device}. The new version was built without the extension.",
  declinedTimeout: "No one approved it on {computer} in 30 minutes, so the new version was built without the extension. To add it, ask again and approve it on {computer}.",
};
const zhCN: Lines = {
  appDisabled: "App 已关闭。运行中的任务已停止，排队消息将在重新打开后继续发送。",
  declinedRemote: "已在{device}上取消，新版本已不带扩展构建。",
  declinedTimeout: "30 分钟内没有人在{computer}上批准，新版本已不带扩展构建。如需添加，请重新发起编辑并在{computer}上批准。",
};
const ja: Lines = {
  appDisabled: "App を閉じました。実行中のタスクを停止しました。待機中のメッセージは再度開くと送信されます。",
  declinedRemote: "{device}で取り消されました。新しいバージョンは拡張機能なしでビルドされました。",
  declinedTimeout: "30 分以内に{computer}で承認されなかったため、新しいバージョンは拡張機能なしでビルドされました。追加するには、もう一度編集を依頼し、{computer}で承認してください。",
};
const es: Lines = {
  appDisabled: "La App está cerrada. Se detuvieron las tareas activas; los mensajes en espera continuarán al volver a abrirla.",
  declinedRemote: "Se canceló desde {device}. La nueva versión se creó sin la extensión.",
  declinedTimeout: "Nadie lo aprobó en {computer} en 30 minutos, así que la nueva versión se creó sin la extensión. Para añadirla, vuelve a pedirlo y apruébalo en {computer}.",
};
const fr: Lines = {
  appDisabled: "L’App est fermée. Les tâches en cours sont arrêtées ; les messages en attente reprendront à la réouverture.",
  declinedRemote: "Annulé depuis {device}. La nouvelle version a été créée sans l’extension.",
  declinedTimeout: "Personne ne l’a approuvée sur {computer} en 30 minutes ; la nouvelle version a donc été créée sans l’extension. Pour l’ajouter, refaites la demande et approuvez-la sur {computer}.",
};
/** Exported for the table test only. */
export const REMOTE_NOTICE_TABLES = { en, "zh-CN": zhCN, ja, es, fr } as const;

/** `computer` is the computer that runs the Chat (the host's name for it). */
export function remoteNoticeText(notice: ChatNotice, locale: string, values: { computer: string }): string | null {
  const lines = REMOTE_NOTICE_TABLES[resolveAppLocale(locale)];
  if (notice.kind === "app-disabled") return lines.appDisabled;
  if (notice.kind !== "app-extension-declined") return null;
  return notice.by === "remote" ? formatCopy(lines.declinedRemote, { device: notice.deviceName ?? values.computer })
    : formatCopy(lines.declinedTimeout, values);
}
