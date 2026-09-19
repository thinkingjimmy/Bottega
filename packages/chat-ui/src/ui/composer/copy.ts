/**
 * [INPUT]: Host-selected locale with English as the fallback.
 * [OUTPUT]: composerCopy returns localized new-Chat and Project labels in five languages.
 * [POS]: Presentation copy shared by local desktop, remote desktop and browser composers.
 */
const values = {
  en: { empty: "What should we build?", project: "Project", none: "No project" },
  "zh-CN": { empty: "我们来做点什么？", project: "项目", none: "无项目" },
  ja: { empty: "何を作りましょうか？", project: "プロジェクト", none: "プロジェクトなし" },
  fr: { empty: "Que voulez-vous créer ?", project: "Projet", none: "Aucun projet" },
  es: { empty: "¿Qué vamos a crear?", project: "Proyecto", none: "Sin proyecto" },
};
export function composerCopy(locale: string) { return values[locale as keyof typeof values] ?? values.en; }
