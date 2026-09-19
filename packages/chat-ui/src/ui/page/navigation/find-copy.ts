/**
 * [INPUT]: Host language and interpolation values.
 * [OUTPUT]: Shared five-language transcript search copy.
 * [POS]: The page navigation's search vocabulary beside find.tsx.
 */
import type { FindTranslation } from "./find";
const copies: Record<string, Record<string, string>> = {
  "en": {
    "findPlaceholder": "Find in conversation",
    "findCount": "{{current}} / {{total}}",
    "findNoMatches": "No matches",
    "findPrevious": "Previous match",
    "findNext": "Next match",
    "findClose": "Close find",
    "findLoading": "Indexing…",
    "findFailed": "Index failed",
    "findRetry": "Retry"
  },
  "zh": {
    "findPlaceholder": "在对话中查找",
    "findCount": "{{current}} / {{total}}",
    "findNoMatches": "无匹配",
    "findPrevious": "上一个匹配",
    "findNext": "下一个匹配",
    "findClose": "关闭查找",
    "findLoading": "正在建立索引…",
    "findFailed": "索引失败",
    "findRetry": "重试"
  },
  "ja": {
    "findPlaceholder": "会話内を検索",
    "findCount": "{{current}} / {{total}}",
    "findNoMatches": "一致なし",
    "findPrevious": "前の一致",
    "findNext": "次の一致",
    "findClose": "検索を閉じる",
    "findLoading": "索引を作成中…",
    "findFailed": "索引に失敗しました",
    "findRetry": "再試行"
  },
  "fr": {
    "findPlaceholder": "Rechercher dans la conversation",
    "findCount": "{{current}} / {{total}}",
    "findNoMatches": "Aucun résultat",
    "findPrevious": "Résultat précédent",
    "findNext": "Résultat suivant",
    "findClose": "Fermer la recherche",
    "findLoading": "Indexation…",
    "findFailed": "Échec de l’index",
    "findRetry": "Réessayer"
  },
  "es": {
    "findPlaceholder": "Buscar en la conversación",
    "findCount": "{{current}} / {{total}}",
    "findNoMatches": "Sin coincidencias",
    "findPrevious": "Coincidencia anterior",
    "findNext": "Coincidencia siguiente",
    "findClose": "Cerrar búsqueda",
    "findLoading": "Indexando…",
    "findFailed": "Falló el índice",
    "findRetry": "Reintentar"
  }
};
export function findTranslation(locale: string): FindTranslation {
  const copy = copies[locale.toLowerCase().split("-")[0]!] ?? copies.en!;
  return (key, values = {}) => (copy[key.replace(/^history\./, "")] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name] ?? ""));
}
