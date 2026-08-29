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
  unavailable: {
    busy: "Wait for the active turn to finish before editing.",
    queued: "Clear or finish queued messages before editing.",
    "adopted-history": "Imported conversations keep their adopted session lineage and cannot be revised.",
  },
};

export const chatRevisionZhCN = {
  notIdle: "聊天正在进行或还有排队消息，等它安静下来再发送修订。",
  stale: "会话已前进，这条消息不再是最后一条；请对最新一条消息重新发起编辑。",
  edit: "编辑消息",
  cancel: "取消",
  send: "发送修订",
  editing: "编辑最后一条消息",
  unavailable: {
    busy: "当前轮次结束后才能编辑。",
    queued: "请先处理完排队消息再编辑。",
    "adopted-history": "收养会话必须保留原生 Session 血缘，暂不支持修订。",
  },
};

export const chatRevisionJa = {
  notIdle: "チャットが実行中か、キューにメッセージがあります。落ち着いてから修正版を送信してください。",
  stale: "会話が進み、このメッセージは最後ではなくなりました。最新のメッセージを編集し直してください。",
  edit: "メッセージを編集",
  cancel: "キャンセル",
  send: "修正版を送信",
  editing: "最後のメッセージを編集",
  unavailable: {
    busy: "実行中のターンが終了してから編集してください。",
    queued: "キューのメッセージを完了または削除してから編集してください。",
    "adopted-history": "取り込んだ会話は元の Session 系譜を保持するため編集できません。",
  },
};

export const chatRevisionFr = {
  notIdle: "La conversation est occupée ou des messages sont en file. Attendez qu’elle se stabilise puis renvoyez la révision.",
  stale: "La conversation a avancé et ce message n’est plus le dernier. Modifiez plutôt le message le plus récent.",
  edit: "Modifier le message",
  cancel: "Annuler",
  send: "Envoyer la révision",
  editing: "Modifier le dernier message",
  unavailable: {
    busy: "Attendez la fin du tour actif avant de modifier.",
    queued: "Terminez ou retirez les messages en file avant de modifier.",
    "adopted-history": "Les conversations importées conservent leur lignée de Session et ne peuvent pas être révisées.",
  },
};

export const chatRevisionEs = {
  notIdle: "El chat está ocupado o tiene mensajes en cola. Espera a que se estabilice y vuelve a enviar la revisión.",
  stale: "La conversación avanzó y este mensaje ya no es el último. Edita el mensaje más reciente.",
  edit: "Editar mensaje",
  cancel: "Cancelar",
  send: "Enviar revisión",
  editing: "Editar el último mensaje",
  unavailable: {
    busy: "Espera a que termine el turno activo antes de editar.",
    queued: "Completa o elimina los mensajes en cola antes de editar.",
    "adopted-history": "Las conversaciones importadas conservan su linaje de Session y no se pueden revisar.",
  },
};
