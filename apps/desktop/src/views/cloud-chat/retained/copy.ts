/**
 * [INPUT]: Depends on the selected interface locale.
 * [OUTPUT]: Provides concise retained-content and deleted-mirror candidate labels.
 * [POS]: Local recovery catalog copy; technical operation identities remain outside the UI.
 */
const en = { title: "Retained content", description: "Content kept on this computer after a deletion or a device change.",
  empty: "No retained content for this account.", unnamed: "Retained Chat", metadata: "Unsent changes", original: "Original title",
  proposed: "Unsent title", automatic: "Automatic title", archived: "Move to archive", unarchived: "Restore from archive", candidate: "The cloud Chat was deleted. These changes remain on this computer.",
  more: "Load more", loading: "Loading…", retry: "Retry", error: "Retained content could not be loaded." };
type Copy = { [K in keyof typeof en]: string };
const copies: Record<string, Copy> = {
  en,
  zh: { automatic: "自动标题", title: "保留的内容", description: "删除或切换电脑后，保存在此电脑的内容。", empty: "此账号暂无保留内容。", unnamed: "保留的 Chat", metadata: "未提交的修改", original: "原始标题", proposed: "未提交的标题", archived: "移至归档", unarchived: "从归档恢复", candidate: "云端 Chat 已删除。这些修改仍保存在此电脑。", more: "加载更多", loading: "正在读取…", retry: "重试", error: "暂时无法读取保留内容。" },
  ja: { automatic: "自動タイトル", title: "保存された内容", description: "削除やパソコン切り替え後も、このパソコンに保存されている内容です。", empty: "このアカウントの保存内容はありません。", unnamed: "保存された Chat", metadata: "未送信の変更", original: "元のタイトル", proposed: "未送信のタイトル", archived: "アーカイブへ移動", unarchived: "アーカイブから復元", candidate: "クラウドの Chat は削除されました。変更はこのパソコンに保存されています。", more: "もっと表示", loading: "読み込み中…", retry: "再試行", error: "保存内容を読み込めませんでした。" },
  es: { automatic: "Título automático", title: "Contenido conservado", description: "Contenido guardado en este ordenador tras eliminar o cambiar de dispositivo.", empty: "Esta cuenta no tiene contenido conservado.", unnamed: "Chat conservado", metadata: "Cambios sin enviar", original: "Título original", proposed: "Título sin enviar", archived: "Archivar", unarchived: "Restaurar del archivo", candidate: "Se eliminó el Chat de la nube. Estos cambios siguen guardados en este ordenador.", more: "Cargar más", loading: "Cargando…", retry: "Reintentar", error: "No se pudo cargar el contenido conservado." },
  fr: { automatic: "Titre automatique", title: "Contenu conservé", description: "Contenu conservé sur cet ordinateur après une suppression ou un changement d’appareil.", empty: "Aucun contenu conservé pour ce compte.", unnamed: "Chat conservé", metadata: "Modifications non envoyées", original: "Titre original", proposed: "Titre non envoyé", archived: "Archiver", unarchived: "Restaurer des archives", candidate: "Le Chat a été supprimé du cloud. Ces modifications restent sur cet ordinateur.", more: "Afficher plus", loading: "Chargement…", retry: "Réessayer", error: "Le contenu conservé n’a pas pu être chargé." },
};
export const retainedCopy = (locale: string) => copies[locale.toLowerCase().split("-")[0]!] ?? en;
