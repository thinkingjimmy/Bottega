/**
 * [INPUT]: The supported App locale and a canonical component without current mount evidence.
 * [OUTPUT]: unverifiedComponentCopy and assetReplacementCopy provide truthful five-language status, action and error text.
 * [POS]: Trusted System host copy; it never changes component verification or source authority.
 */
export function unverifiedComponentCopy(locale: string) {
  return locale.startsWith("zh") ? "此保存版本没有经过验证的交互预览。请打开 来源文件查看状态并重新编译组件。"
    : locale.startsWith("ja") ? "この保存済みバージョンに検証済みの対話プレビューはありません。出典ファイルで状態を確認し、コンポーネントを再コンパイルしてください。"
    : locale.startsWith("es") ? "Esta versión guardada no tiene una vista interactiva verificada. Abre Archivos de origen para consultar el estado y compilar de nuevo."
    : locale.startsWith("fr") ? "Cette version enregistrée n’a pas d’aperçu interactif vérifié. Ouvrez Fichiers source pour consulter son état et recompiler le composant."
    : "This saved version has no verified interactive preview. Open Source files to inspect its status and compile the component again.";
}

const assetEnglish = { replace:"Replace…",saving:"Saving…",close:"Close",unavailable:"Open the current editable System before replacing this image.",invalidFile:"Choose an image up to 8 MiB.",sourceUnavailable:"The System source is unavailable.",selectionChanged:"The selected image changed. Open it again.",typeMismatch:"Choose the same image type to preserve existing links",uploadedChanged:"The uploaded image identity changed.",changedDuringUpload:"The image changed during upload. Compare the saved version before trying again." };
type AssetCopy = Record<keyof typeof assetEnglish,string>;
const assetZh:AssetCopy={replace:"替换…",saving:"正在保存…",close:"关闭",unavailable:"请打开当前可编辑的设计系统后再替换图片。",invalidFile:"请选择不超过 8 MiB 的图片。",sourceUnavailable:"设计系统源文件暂不可用。",selectionChanged:"所选图片已变化，请重新打开。",typeMismatch:"请选择相同图片格式，以保留现有引用。",uploadedChanged:"上传图片的标识已变化。",changedDuringUpload:"图片在上传期间发生变化，请比较已保存版本后再重试。"};
const assetJa:AssetCopy={replace:"置き換える…",saving:"保存中…",close:"閉じる",unavailable:"現在の編集可能なデザインシステムを開いてから画像を置き換えてください。",invalidFile:"8 MiB 以下の画像を選択してください。",sourceUnavailable:"システムのソースを利用できません。",selectionChanged:"選択した画像が変更されました。もう一度開いてください。",typeMismatch:"既存の参照を保つため、同じ画像形式を選択してください。",uploadedChanged:"アップロードした画像の識別情報が変わりました。",changedDuringUpload:"アップロード中に画像が変わりました。保存済みバージョンを比較してから再試行してください。"};
const assetEs:AssetCopy={replace:"Reemplazar…",saving:"Guardando…",close:"Cerrar",unavailable:"Abre el sistema editable actual antes de reemplazar la imagen.",invalidFile:"Elige una imagen de hasta 8 MiB.",sourceUnavailable:"El origen del sistema no está disponible.",selectionChanged:"La imagen seleccionada cambió. Ábrela de nuevo.",typeMismatch:"Elige el mismo formato de imagen para conservar las referencias.",uploadedChanged:"Cambió la identidad de la imagen subida.",changedDuringUpload:"La imagen cambió durante la subida. Compara la versión guardada antes de reintentar."};
const assetFr:AssetCopy={replace:"Remplacer…",saving:"Enregistrement…",close:"Fermer",unavailable:"Ouvrez le système actuel modifiable avant de remplacer cette image.",invalidFile:"Choisissez une image de 8 MiB maximum.",sourceUnavailable:"La source du système est indisponible.",selectionChanged:"L’image sélectionnée a changé. Ouvrez-la à nouveau.",typeMismatch:"Choisissez le même format d’image pour conserver les références.",uploadedChanged:"L’identité de l’image importée a changé.",changedDuringUpload:"L’image a changé pendant l’importation. Comparez la version enregistrée avant de réessayer."};
export function assetReplacementCopy(locale:string):AssetCopy{return locale.startsWith("zh")?assetZh:locale.startsWith("ja")?assetJa:locale.startsWith("es")?assetEs:locale.startsWith("fr")?assetFr:assetEnglish;}
