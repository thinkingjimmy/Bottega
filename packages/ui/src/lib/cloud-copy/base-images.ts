/**
 * [INPUT]: Depends on the shared five-language locale selector.
 * [OUTPUT]: Provides browser Base image availability and upload guidance.
 * [POS]: Shared presentation copy; attachment transport injects it without owning language state.
 */
import { pickCloudLocale } from "./locale";
const en = { unavailable: "Image is unavailable", sourceOnly: "Image is only available on its source computer", upload: "Use the record editor to upload an image" };
const zhCN = { unavailable: "图片不可用", sourceOnly: "图片仅可在来源电脑上使用", upload: "请在记录编辑器中上传图片" };
const ja = { unavailable: "画像を利用できません", sourceOnly: "画像は元のパソコンでのみ利用できます", upload: "レコード編集画面で画像をアップロードしてください" };
const fr = { unavailable: "L’image est indisponible", sourceOnly: "L’image est disponible uniquement sur son ordinateur d’origine", upload: "Utilisez l’éditeur de fiche pour téléverser une image" };
const es = { unavailable: "La imagen no está disponible", sourceOnly: "La imagen solo está disponible en el ordenador de origen", upload: "Usa el editor del registro para subir una imagen" };
export const baseImageCopy = (locale: string) => pickCloudLocale(locale, { en, zhCN, ja, fr, es });
