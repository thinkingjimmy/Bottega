/**
 * [INPUT]: The host presentation locale and shared connection vocabulary.
 * [OUTPUT]: computerCopy adds five-language computer, access and offline composer guidance.
 * [POS]: Loaded with remote Chat surfaces; admission does not import computer-specific sentences.
 */
import { connectionCopy } from "./connection-copy";
const en = {
    disconnectedBody: "You can send messages when the connection returns. Existing conversations remain available.",
    computerUnavailable: "Unable to connect to the computer",
    computerBody: "You can send messages when {name} reconnects.",
    computerAsleep: "The computer is asleep",
    wake: "Wake {name} to send messages.",
    open: "Check that Bottega is open on {name}.",
    locked: "Unlock sync on {name} to send messages.",
    privacy: "Confirm the privacy settings on {name} to continue.",
    noComputer: "Open Bottega on your computer and complete sync to send messages here.",
};
type Copy = { [K in keyof typeof en]: string };
const copies: Record<string, Copy> = {
  en,
  zh: {
    disconnectedBody: "连接恢复后即可发送消息，已有对话仍可阅读。",
    computerUnavailable: "暂时无法连接电脑",
    computerBody: "{name} 恢复连接后即可发送消息。",
    computerAsleep: "电脑已休眠",
    wake: "唤醒 {name} 后即可发送消息。",
    open: "请确认 {name} 上的 Bottega 已打开。",
    locked: "请在 {name} 上解锁同步，然后继续发送。",
    privacy: "请在 {name} 上确认隐私设置。",
    noComputer: "在电脑上打开 Bottega 并完成同步，即可在这里发送消息。",
  },
  ja: {
    disconnectedBody: "接続が戻るとメッセージを送信できます。既存の会話は引き続き読めます。",
    computerUnavailable: "パソコンに接続できません",
    computerBody: "{name} が再接続すると送信できます。",
    computerAsleep: "パソコンがスリープ中です",
    wake: "{name} を起動すると送信できます。",
    open: "{name} で Bottega が開いているか確認してください。",
    locked: "{name} で同期のロックを解除してください。",
    privacy: "{name} でプライバシー設定を確認してください。",
    noComputer: "パソコンで Bottega を開き、同期を完了すると送信できます。",
  },
  fr: {
    disconnectedBody: "Vous pourrez envoyer des messages au retour de la connexion. Les conversations restent lisibles.",
    computerUnavailable: "Connexion à l’ordinateur impossible",
    computerBody: "Vous pourrez envoyer des messages quand {name} se reconnectera.",
    computerAsleep: "L’ordinateur est en veille",
    wake: "Réveillez {name} pour envoyer des messages.",
    open: "Vérifiez que Bottega est ouvert sur {name}.",
    locked: "Déverrouillez la synchronisation sur {name}.",
    privacy: "Confirmez les paramètres de confidentialité sur {name}.",
    noComputer: "Ouvrez Bottega sur votre ordinateur et terminez la synchronisation pour envoyer des messages.",
  },
  es: {
    disconnectedBody: "Podrás enviar mensajes cuando vuelva la conexión. Las conversaciones siguen disponibles para leer.",
    computerUnavailable: "No se puede conectar al ordenador",
    computerBody: "Podrás enviar mensajes cuando {name} se conecte de nuevo.",
    computerAsleep: "El ordenador está en reposo",
    wake: "Activa {name} para enviar mensajes.",
    open: "Comprueba que Bottega esté abierto en {name}.",
    locked: "Desbloquea la sincronización en {name}.",
    privacy: "Confirma la configuración de privacidad en {name}.",
    noComputer: "Abre Bottega en tu ordenador y completa la sincronización para enviar mensajes.",
  },
};
export const computerCopy = (locale: string) => ({ ...connectionCopy(locale), ...(copies[locale.toLowerCase().split("-")[0]!] ?? en) });
