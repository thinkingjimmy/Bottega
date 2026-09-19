/**
 * [INPUT]: Host locale.
 * [OUTPUT]: Five-language attachment status, limit, draft restoration and session confirmation copy.
 * [POS]: Remote composer feedback, separate from shared native control labels.
 */
import { resolveAppLocale } from "@ai-chat/ui/lib/locale";
const en = { loadingReferences: "Loading references…", noFiles: "No matching files", nextMessage: "For next message", currentTurn: "For current turn", referenceChanged: "The computer changed. Remove or reselect file references.", restoreDraft: "Restore draft", remove: "Remove {name}", retry: "Retry upload", uploading: "Uploading", failed: "Upload failed. Your file is retained.",
  limits: "Up to 8 files, 8 MiB each. Images: PNG, JPEG, GIF or WebP.",
  scope: "For this chat on {computer}", preview: "Preview {name}", previewFile: "Preview file", download: "Download", guide: "Guide this turn", attach: "Files" };
const values: Record<string, typeof en> = {
  en,
  "zh-CN": { loadingReferences: "正在读取引用…", noFiles: "没有匹配的文件", nextMessage: "用于下一条消息", currentTurn: "用于当前轮插话", referenceChanged: "电脑已改变，请移除或重新选择文件引用。", restoreDraft: "恢复草稿", remove: "移除 {name}", retry: "重试上传", uploading: "上传中", failed: "上传失败，文件已保留。", limits: "每条最多 8 个文件，单个不超过 8 MiB。图片支持 PNG、JPEG、GIF、WebP。", scope: "仅用于「{computer}」上的当前会话", preview: "预览 {name}", previewFile: "预览文件", download: "下载", guide: "引导当前轮", attach: "文件" },
  ja: { loadingReferences: "参照を読み込み中…", noFiles: "一致するファイルはありません", nextMessage: "次のメッセージ用", currentTurn: "現在のターン用", referenceChanged: "パソコンが変わりました。ファイル参照を削除するか選び直してください。", restoreDraft: "下書きを復元", remove: "{name} を削除", retry: "アップロードを再試行", uploading: "アップロード中", failed: "アップロードできませんでした。ファイルは保持されています。", limits: "最大 8 ファイル、各 8 MiB。画像は PNG、JPEG、GIF、WebP。", scope: "{computer} のこのチャットのみ", preview: "{name} をプレビュー", previewFile: "ファイルをプレビュー", download: "ダウンロード", guide: "このターンを指示", attach: "ファイル" },
  fr: { loadingReferences: "Chargement des références…", noFiles: "Aucun fichier correspondant", nextMessage: "Pour le prochain message", currentTurn: "Pour le tour actuel", referenceChanged: "L’ordinateur a changé. Supprimez ou sélectionnez à nouveau les références.", restoreDraft: "Restaurer le brouillon", remove: "Retirer {name}", retry: "Réessayer l’envoi", uploading: "Envoi", failed: "Échec de l’envoi. Votre fichier est conservé.", limits: "8 fichiers maximum, 8 Mio chacun. Images : PNG, JPEG, GIF ou WebP.", scope: "Pour cette conversation sur {computer}", preview: "Aperçu de {name}", previewFile: "Aperçu du fichier", download: "Télécharger", guide: "Guider ce tour", attach: "Fichiers" },
  es: { loadingReferences: "Cargando referencias…", noFiles: "No hay archivos coincidentes", nextMessage: "Para el próximo mensaje", currentTurn: "Para el turno actual", referenceChanged: "El ordenador cambió. Quita o vuelve a seleccionar las referencias.", restoreDraft: "Restaurar borrador", remove: "Quitar {name}", retry: "Reintentar carga", uploading: "Subiendo", failed: "Error al subir. El archivo se conserva.", limits: "Hasta 8 archivos, de 8 MiB cada uno. Imágenes: PNG, JPEG, GIF o WebP.", scope: "Para este chat en {computer}", preview: "Vista previa de {name}", previewFile: "Vista previa del archivo", download: "Descargar", guide: "Guiar este turno", attach: "Archivos" },
};
export const remoteInputCopy = (locale: string) => values[resolveAppLocale(locale)] ?? en;
