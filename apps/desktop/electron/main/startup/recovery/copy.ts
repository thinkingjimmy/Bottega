/**
 * [INPUT]: Depends on the resolved application locale.
 * [OUTPUT]: Provides five-language recovery actions with a precise data-loss boundary, plus the folder relocate/adopt/locked/owned-elsewhere copy.
 * [POS]: Startup recovery copy, available before any renderer or account session exists.
 */
const en = { title: "Bottega could not open your data", message: "Your files have been kept. You can inspect the data folder or copy the technical details to get help.",
  open: "Open data folder", copy: "Copy technical details", report: "Report on GitHub", rebuild: "Rebuild from Bottega folder", close: "Close Bottega", cancel: "Cancel",
  confirm: "Rebuild the local database?", disclosure: "The previous database will be preserved. Conversations will be restored from your Bottega folder; unfinished replies may be missing. Search indexes and cloud synchronization state will be recreated. Your keys and settings will remain on this computer." };
type Copy = typeof en;
const locales: Record<string, Copy> = {
  en,
  "zh-CN": { title: "Bottega 暂时无法打开数据", message: "文件已保留。你可以打开数据目录检查，或复制技术详情获取帮助。", open: "打开数据目录", copy: "复制技术详情", report: "在 GitHub 反馈", rebuild: "从 Bottega 文件夹重建", close: "关闭 Bottega", cancel: "取消", confirm: "重建本机数据库？", disclosure: "旧数据库会保留。对话将从 Bottega 文件夹恢复，尚未完成的回复可能缺失。搜索索引与云端同步状态将重新建立，密钥和设置仍保留在本机。" },
  ja: { title: "Bottega がデータを開けませんでした", message: "ファイルは保持されています。データフォルダーを確認するか、技術情報をコピーしてサポートを受けられます。", open: "データフォルダーを開く", copy: "技術情報をコピー", report: "GitHub で報告", rebuild: "Bottega フォルダーから再構築", close: "Bottega を閉じる", cancel: "キャンセル", confirm: "ローカルデータベースを再構築しますか？", disclosure: "以前のデータベースは保持されます。会話は Bottega フォルダーから復元されますが、未完了の返信が欠ける場合があります。検索索引とクラウド同期状態を再作成します。鍵と設定はこのコンピューターに残ります。" },
  fr: { title: "Bottega n’a pas pu ouvrir vos données", message: "Vos fichiers sont conservés. Ouvrez le dossier de données ou copiez les détails techniques pour obtenir de l’aide.", open: "Ouvrir le dossier de données", copy: "Copier les détails techniques", report: "Signaler sur GitHub", rebuild: "Reconstruire depuis le dossier Bottega", close: "Fermer Bottega", cancel: "Annuler", confirm: "Reconstruire la base locale ?", disclosure: "La base précédente sera conservée. Les conversations seront restaurées depuis le dossier Bottega ; des réponses inachevées peuvent manquer. Les index de recherche et l’état de synchronisation seront recréés. Les clés et réglages restent sur cet ordinateur." },
  es: { title: "Bottega no pudo abrir tus datos", message: "Tus archivos se han conservado. Puedes abrir la carpeta de datos o copiar los detalles técnicos para pedir ayuda.", open: "Abrir carpeta de datos", copy: "Copiar detalles técnicos", report: "Informar en GitHub", rebuild: "Reconstruir desde la carpeta Bottega", close: "Cerrar Bottega", cancel: "Cancelar", confirm: "¿Reconstruir la base de datos local?", disclosure: "Se conservará la base anterior. Las conversaciones se restaurarán desde la carpeta Bottega; pueden faltar respuestas sin terminar. Se recrearán los índices de búsqueda y el estado de sincronización. Las claves y los ajustes seguirán en este equipo." },
};
export const recoveryCopy = (locale: string) => locales[locale] ?? locales[locale.split("-")[0]!] ?? en;

const notices = {
  en: { custody: "An earlier Agent process may still be using files. Execution and cleanup will resume after it exits.", settings: "Some settings could not be read and were reset. The original settings file has been preserved." },
  "zh-CN": { custody: "之前的 Agent 进程可能仍在使用文件。确认它退出后，执行与清理将自动恢复。", settings: "部分设置无法读取，已恢复默认值。原设置文件已保留。" },
  ja: { custody: "以前の Agent がファイルを使用している可能性があります。終了を確認すると、実行とクリーンアップを再開します。", settings: "一部の設定を読み込めず、初期値に戻しました。元の設定ファイルは保持されています。" },
  fr: { custody: "Un ancien Agent peut encore utiliser des fichiers. L’exécution et le nettoyage reprendront après sa fermeture.", settings: "Certains réglages étaient illisibles et ont été réinitialisés. Le fichier original est conservé." },
  es: { custody: "Un Agent anterior podría seguir usando archivos. La ejecución y la limpieza se reanudarán cuando termine.", settings: "Algunos ajustes no se pudieron leer y se restablecieron. Se conservó el archivo original." },
};
export function recoveryNotice(category: "custody" | "settings", locale: string) {
  return (notices[locale as keyof typeof notices] ?? notices[locale.split("-")[0] as keyof typeof notices] ?? notices.en)[category];
}

/* The folder branch is a different conversation from a database failure: nothing is
   broken, a folder is simply not where it was, so every action names what it does to
   the user's own files rather than to Bottega's internals. */
const libraryEn = {
  missingTitle: "Your Bottega folder was not found",
  missingMessage: "Bottega keeps your conversations, Projects, Bases, Apps and Skills in this folder. It is no longer at this location, or it now holds different data.",
  /* Not a failure: the folder is intact and in use, just not by this computer. */
  ownedTitle: "This Bottega folder belongs to another computer",
  ownedMessage: "This Bottega folder belongs to {host}. This version cannot open it on another computer — start a new folder here, or use it on that computer.",
  differentFolder: "That folder is a different Bottega folder. Choose the folder this installation has been using.",
  locate: "Locate folder…", startNew: "Start with a new folder…", startNewConfirm: "Start with a new folder?",
  startNewDisclosure: "Your conversations stay on this computer and will be copied into the new folder. Projects, Bases, Apps and Skills from the old folder are not recovered. Nothing in the old folder is changed.",
  lockedTitle: "This folder is open in another Bottega", lockedMessage: "Another Bottega on this computer is using this folder. Close it there, then retry.",
  retry: "Retry", quit: "Quit", cancel: "Cancel",
};
type LibraryCopy = typeof libraryEn;
const libraries: Record<string, LibraryCopy> = {
  en: libraryEn,
  "zh-CN": { missingTitle: "没有找到你的 Bottega 文件夹", missingMessage: "你的对话、Project、Base、App 与 Skills 都放在这个文件夹里。它已不在这个位置，或者里面换成了另一份数据。",
    ownedTitle: "这个 Bottega 文件夹属于另一台电脑", ownedMessage: "这个 Bottega 文件夹属于电脑 {host}，当前版本不支持在另一台电脑上打开；新建一个文件夹，或在那台电脑上使用。",
    differentFolder: "这是另一个 Bottega 文件夹。请选择本机一直在用的那一个。", locate: "定位文件夹…", startNew: "改用新文件夹…", startNewConfirm: "改用新文件夹？",
    startNewDisclosure: "对话保存在这台电脑上，会被复制到新文件夹。旧文件夹里的 Project、Base、App 与 Skills 不会恢复。旧文件夹不会被改动。",
    lockedTitle: "这个文件夹已被另一个 Bottega 打开", lockedMessage: "本机另一个 Bottega 正在使用这个文件夹。请先关闭它，然后重试。", retry: "重试", quit: "退出", cancel: "取消" },
  ja: { missingTitle: "Bottega フォルダーが見つかりません", missingMessage: "会話、Project、Base、App、Skills はこのフォルダーに保存されています。この場所から移動したか、別のデータに入れ替わっています。",
    ownedTitle: "この Bottega フォルダーは別のコンピューターのものです", ownedMessage: "この Bottega フォルダーは {host} のものです。現在のバージョンでは別のコンピューターで開けません。新しいフォルダーを作るか、そのコンピューターで使ってください。",
    differentFolder: "これは別の Bottega フォルダーです。これまで使っていたフォルダーを選んでください。", locate: "フォルダーを指定…", startNew: "新しいフォルダーで始める…", startNewConfirm: "新しいフォルダーで始めますか？",
    startNewDisclosure: "会話はこのコンピューターに残り、新しいフォルダーへコピーされます。以前のフォルダーの Project、Base、App、Skills は復元されません。以前のフォルダーは変更されません。",
    lockedTitle: "このフォルダーは別の Bottega で開かれています", lockedMessage: "このコンピューターの別の Bottega がこのフォルダーを使用しています。終了してから再試行してください。", retry: "再試行", quit: "終了", cancel: "キャンセル" },
  fr: { missingTitle: "Votre dossier Bottega est introuvable", missingMessage: "Bottega conserve vos conversations, Projects, Bases, Apps et Skills dans ce dossier. Il n’est plus à cet emplacement, ou il contient désormais d’autres données.",
    ownedTitle: "Ce dossier Bottega appartient à un autre ordinateur", ownedMessage: "Ce dossier Bottega appartient à {host}. Cette version ne peut pas l’ouvrir sur un autre ordinateur : créez un nouveau dossier ici, ou utilisez-le sur cet ordinateur-là.",
    differentFolder: "Ce dossier est un autre dossier Bottega. Choisissez celui que cette installation utilisait.", locate: "Localiser le dossier…", startNew: "Commencer avec un nouveau dossier…", startNewConfirm: "Commencer avec un nouveau dossier ?",
    startNewDisclosure: "Vos conversations restent sur cet ordinateur et seront copiées dans le nouveau dossier. Les Projects, Bases, Apps et Skills de l’ancien dossier ne sont pas récupérés. Rien n’est modifié dans l’ancien dossier.",
    lockedTitle: "Ce dossier est ouvert dans un autre Bottega", lockedMessage: "Un autre Bottega de cet ordinateur utilise ce dossier. Fermez-le, puis réessayez.", retry: "Réessayer", quit: "Quitter", cancel: "Annuler" },
  es: { missingTitle: "No se encontró tu carpeta de Bottega", missingMessage: "Bottega guarda tus conversaciones, Projects, Bases, Apps y Skills en esta carpeta. Ya no está en esta ubicación o ahora contiene otros datos.",
    ownedTitle: "Esta carpeta de Bottega pertenece a otro ordenador", ownedMessage: "Esta carpeta de Bottega pertenece a {host}. Esta versión no puede abrirla en otro ordenador: crea una carpeta nueva aquí o úsala en ese ordenador.",
    differentFolder: "Esa carpeta es otra carpeta de Bottega. Elige la que ha estado usando esta instalación.", locate: "Localizar carpeta…", startNew: "Empezar con una carpeta nueva…", startNewConfirm: "¿Empezar con una carpeta nueva?",
    startNewDisclosure: "Tus conversaciones permanecen en este ordenador y se copiarán en la carpeta nueva. Los Projects, Bases, Apps y Skills de la carpeta anterior no se recuperan. No se modifica nada en la carpeta anterior.",
    lockedTitle: "Esta carpeta está abierta en otro Bottega", lockedMessage: "Otro Bottega de este ordenador está usando esta carpeta. Ciérralo y vuelve a intentarlo.", retry: "Reintentar", quit: "Salir", cancel: "Cancelar" },
};
export const libraryRecoveryCopy = (locale: string) => libraries[locale] ?? libraries[locale.split("-")[0]!] ?? libraryEn;
