/**
 * [INPUT]: Depends on the selected UI language and confirmed device/preparation states.
 * [OUTPUT]: Provides consistent execution-device and explicit local-continuation/deletion copy in five languages.
 * [POS]: Shared status copy; no inference about a remote process stopping is made from presence.
 */
const en = { deleted: "Deleted from sync. Local content is retained; save a copy from the recovery panel to continue.", computer: "Another computer", online: "Online", offline: "Offline", revoked: "Device revoked", runningOn: "Running on {device}",
  from: "From {device}", continueHere: "Continue on this computer", claiming: "Taking over…", preparing: "Preparing this conversation…", retryPreparation: "Retry preparation",
  draft: "Write a message", draftHint: "Continue on this computer before sending.", bindProject: "Bind a project folder", authorize: "Complete local authorization",
  unavailable: "Connect to sync before continuing on this computer.", archived: "Restore this conversation before continuing.", running: "This computer is still running a reply. Wait or handle it there.",
  homePartial: "Some Home files could not be restored.", failed: "Preparation failed. Your draft is saved.", local: "This computer",
  localBusy: "Resolve the unfinished local reply before continuing.", identityChanged: "The execution computer changed. Review its status before retrying.",
  draftFailed: "The draft could not be saved to this computer. Keep this page open and retry.", retryDraft: "Save draft again",
  settling: "Saving the previous reply…", body: "Downloading conversation history…", home: "Preparing Home files…", attachments: "Preparing attachments…",
  bodyFailed: "Conversation history is not ready. Retry preparation.", homeFailed: "Home files are not ready. Retry preparation.",
  remotePreparing: "Switched to {device} · Preparing", remoteReady: "Switched to {device} · Ready to continue there",
  appReadonly: "This dedicated App conversation is read-only here. It cannot be taken over." };
export type ExecutionCopy = { [K in keyof typeof en]: string };
const copies: Record<string, ExecutionCopy> = {
  en,
  zh: { deleted: "此对话已从云端删除，本机内容仍保留。可在保留分支中另存副本后继续。", computer: "其他电脑", online: "在线", offline: "离线", revoked: "设备已撤销", runningOn: "在 {device} 上运行", from: "来自 {device}", continueHere: "在此电脑继续", claiming: "正在接管…",
    preparing: "正在准备此对话…", retryPreparation: "重试准备", draft: "输入消息", draftHint: "在此电脑继续后可发送。", bindProject: "绑定项目路径", authorize: "完成本机授权",
    unavailable: "请连接同步后在此电脑继续。", archived: "请先恢复已归档的对话。", running: "该电脑正在回复，请等待或在该电脑处理。", homePartial: "部分 Home 文件未能恢复。", failed: "准备失败，草稿已保留。", local: "本机",
    localBusy: "请先处理本机尚未结束的回复。", identityChanged: "执行电脑已变化，请确认当前状态后重试。", draftFailed: "草稿尚未保存到本机，请保留此页面并重试。", retryDraft: "重新保存草稿",
    settling: "正在保存上一条回复…", body: "正在补齐对话历史…", home: "正在准备 Home 文件…", attachments: "正在准备附件…",
    bodyFailed: "对话历史尚未补齐，请重试准备。", homeFailed: "Home 文件尚未准备好，请重试准备。",
    remotePreparing: "已切换到 {device} · 正在准备", remoteReady: "已切换到 {device} · 可在该电脑继续", appReadonly: "此 App 专用会话仅供阅读，不能在此接管。" },
  ja: { deleted: "同期から削除されました。ローカル内容は保持されています。復元パネルからコピーを保存して続行してください。", computer: "別のパソコン", online: "オンライン", offline: "オフライン", revoked: "デバイスが取り消されました", runningOn: "{device} で実行中", from: "{device} から", continueHere: "このパソコンで続行", claiming: "引き継ぎ中…",
    preparing: "会話を準備中…", retryPreparation: "準備を再試行", draft: "メッセージを入力", draftHint: "送信するにはこのパソコンで続行してください。", bindProject: "プロジェクトのフォルダを設定", authorize: "ローカルの権限を設定",
    unavailable: "同期に接続してから続行してください。", archived: "続行するには会話を復元してください。", running: "そのパソコンで応答中です。待つか、そのパソコンで操作してください。", homePartial: "一部の Home ファイルを復元できませんでした。", failed: "準備できませんでした。下書きは保存されています。", local: "このパソコン",
    localBusy: "ローカルの未完了の応答を先に処理してください。", identityChanged: "実行するパソコンが変更されました。状態を確認して再試行してください。", draftFailed: "下書きを保存できませんでした。このページを開いたまま再試行してください。", retryDraft: "下書きを再保存",
    settling: "前の応答を保存中…", body: "会話履歴を取得中…", home: "Home ファイルを準備中…", attachments: "添付ファイルを準備中…",
    bodyFailed: "会話履歴の準備が未完了です。再試行してください。", homeFailed: "Home ファイルの準備が未完了です。再試行してください。",
    remotePreparing: "{device} に切り替えました · 準備中", remoteReady: "{device} に切り替えました · 続行できます", appReadonly: "この App 専用の会話は閲覧専用です。ここでは引き継げません。" },
  fr: { deleted: "Supprimée de la synchronisation. Le contenu local est conservé. Enregistrez une copie depuis le panneau de récupération pour continuer.", computer: "Un autre ordinateur", online: "En ligne", offline: "Hors ligne", revoked: "Appareil révoqué", runningOn: "En cours sur {device}", from: "Depuis {device}", continueHere: "Continuer sur cet ordinateur", claiming: "Reprise en cours…",
    preparing: "Préparation de la conversation…", retryPreparation: "Réessayer la préparation", draft: "Écrire un message", draftHint: "Reprenez sur cet ordinateur avant d’envoyer.", bindProject: "Associer un dossier de projet", authorize: "Terminer l’autorisation locale",
    unavailable: "Connectez la synchronisation avant de continuer.", archived: "Restaurez la conversation avant de continuer.", running: "L’ordinateur répond encore. Patientez ou intervenez sur celui-ci.", homePartial: "Certains fichiers Home n’ont pas pu être restaurés.", failed: "Échec de la préparation. Le brouillon est conservé.", local: "Cet ordinateur",
    localBusy: "Traitez la réponse locale inachevée avant de continuer.", identityChanged: "L’ordinateur d’exécution a changé. Vérifiez son état avant de réessayer.", draftFailed: "Le brouillon n’a pas été enregistré. Gardez cette page ouverte et réessayez.", retryDraft: "Réenregistrer le brouillon",
    settling: "Enregistrement de la réponse précédente…", body: "Chargement de l’historique…", home: "Préparation des fichiers Home…", attachments: "Préparation des pièces jointes…",
    bodyFailed: "L’historique n’est pas prêt. Réessayez la préparation.", homeFailed: "Les fichiers Home ne sont pas prêts. Réessayez la préparation.",
    remotePreparing: "Reprise sur {device} · Préparation", remoteReady: "Reprise sur {device} · Prêt à continuer", appReadonly: "Cette conversation dédiée à l’App est en lecture seule ici. La reprise n’est pas disponible." },
  es: { deleted: "Eliminada de la sincronización. El contenido local se conserva. Guarda una copia desde el panel de recuperación para continuar.", computer: "Otro ordenador", online: "En línea", offline: "Sin conexión", revoked: "Dispositivo revocado", runningOn: "En ejecución en {device}", from: "Desde {device}", continueHere: "Continuar en este ordenador", claiming: "Tomando el control…",
    preparing: "Preparando la conversación…", retryPreparation: "Reintentar preparación", draft: "Escribe un mensaje", draftHint: "Continúa en este ordenador antes de enviar.", bindProject: "Vincular carpeta del proyecto", authorize: "Completar autorización local",
    unavailable: "Conecta la sincronización antes de continuar.", archived: "Restaura la conversación antes de continuar.", running: "Ese ordenador sigue respondiendo. Espera o actúa allí.", homePartial: "No se pudieron restaurar algunos archivos Home.", failed: "La preparación falló. El borrador se ha guardado.", local: "Este ordenador",
    localBusy: "Resuelve primero la respuesta local pendiente.", identityChanged: "El ordenador de ejecución ha cambiado. Comprueba su estado antes de reintentar.", draftFailed: "No se pudo guardar el borrador. Mantén esta página abierta y reinténtalo.", retryDraft: "Guardar el borrador de nuevo",
    settling: "Guardando la respuesta anterior…", body: "Descargando el historial…", home: "Preparando archivos Home…", attachments: "Preparando archivos adjuntos…",
    bodyFailed: "El historial no está listo. Reintenta la preparación.", homeFailed: "Los archivos Home no están listos. Reintenta la preparación.",
    remotePreparing: "Se ha cambiado a {device} · Preparando", remoteReady: "Se ha cambiado a {device} · Listo para continuar", appReadonly: "Esta conversación dedicada a la App es de solo lectura aquí. No se puede tomar el control." },
};
export const executionCopy = (locale: string) => copies[locale.toLowerCase().split("-")[0]!] ?? en;
