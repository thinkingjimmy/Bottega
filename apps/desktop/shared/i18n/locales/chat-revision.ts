/**
 * [INPUT]: dependence when not in operation; 5 languages to share and build messages
 * [OUTPUT]: Provides chatRevisionEn/ZhCN/Ja/Fr/Es catalogs
 * [POS]: The new feature catalog for desktop i18n is modified and installed by five top-level locale
 */

export const chatRevisionEn = {
  notIdle: "The chat is busy or has queued messages. Wait for it to settle, then send the revision again.",
  stale: "The conversation moved on and this message is no longer the last one. Refresh and edit the newest message instead.",
  edit: "Edit message",
  cancel: "Cancel",
  send: "Send revision",
  editing: "Edit last message",
  newSession: "A new Agent session started with a limited recap of the earlier conversation.",
  memoryWarning: "If Memory is enabled, superseded content may still be recalled.",
};

export const chatRevisionZhCN = {
  notIdle: "聊天正在进行或还有排队消息，等它安静下来再发送修订。",
  stale: "会话已前进，这条消息不再是最后一条；请对最新一条消息重新发起编辑。",
  edit: "编辑消息",
  cancel: "取消",
  send: "发送修订",
  editing: "编辑最后一条消息",
  newSession: "已开启新 Agent 会话，并携带此前对话回顾（有限预算）。",
  memoryWarning: "若已开启记忆，被替代的旧内容仍可能被召回。",
};

export const chatRevisionJa = {
  notIdle: "チャットが実行中か、キューにメッセージがあります。落ち着いてから修正版を送信してください。",
  stale: "会話が進み、このメッセージは最後ではなくなりました。最新のメッセージを編集し直してください。",
  edit: "メッセージを編集",
  cancel: "キャンセル",
  send: "修正版を送信",
  editing: "最後のメッセージを編集",
  newSession: "以前の会話の限定的な要約を引き継ぎ、新しい Agent セッションを開始しました。",
  memoryWarning: "メモリーが有効な場合、置き換え前の内容が想起されることがあります。",
};

export const chatRevisionFr = {
  notIdle: "La conversation est occupée ou des messages sont en file. Attendez qu’elle se stabilise puis renvoyez la révision.",
  stale: "La conversation a avancé et ce message n’est plus le dernier. Modifiez plutôt le message le plus récent.",
  edit: "Modifier le message",
  cancel: "Annuler",
  send: "Envoyer la révision",
  editing: "Modifier le dernier message",
  newSession: "Une nouvelle session Agent a démarré avec un récapitulatif limité de la conversation.",
  memoryWarning: "Si la mémoire est active, l’ancien contenu peut encore être rappelé.",
};

export const chatRevisionEs = {
  notIdle: "El chat está ocupado o tiene mensajes en cola. Espera a que se estabilice y vuelve a enviar la revisión.",
  stale: "La conversación avanzó y este mensaje ya no es el último. Edita el mensaje más reciente.",
  edit: "Editar mensaje",
  cancel: "Cancelar",
  send: "Enviar revisión",
  editing: "Editar el último mensaje",
  newSession: "Se inició una nueva sesión del Agent con un resumen limitado de la conversación anterior.",
  memoryWarning: "Si Memory está activa, el contenido sustituido aún podría recordarse.",
};
