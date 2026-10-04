/**
 * [INPUT]: Host locale; current Project interpolation remains owned by the consuming presentation.
 * [OUTPUT]: Five native/Web Project selector catalogs and projectSelectorCopy with English fallback.
 * [POS]: The composer Project surface's copy beside selector.tsx; individual exports preserve native locale chunk boundaries.
 */
export type ProjectSelectorCopy = {
  selector: string;
  search: string;
  empty: string;
  create: string;
  creating: string;
  workInChat: string;
  current: string;
  chat: string;
};
export const projectSelectorEn = {
    selector: "Project selector",
    search: "Search Projects",
    empty: "No Projects found",
    create: "New Project",
    creating: "New Project…",
    workInChat: "Work in Chat",
    current: "Current Chat Project: {{project}}",
    chat: "Chat",
  } satisfies ProjectSelectorCopy;

export const projectSelectorZhCn = {
    selector: "Project 选择器",
    search: "搜索 Project",
    empty: "没有找到 Project",
    create: "新建 Project",
    creating: "新建 Project…",
    workInChat: "在 Chat 中工作",
    current: "当前 Chat Project：{{project}}",
    chat: "Chat",
  } satisfies ProjectSelectorCopy;

export const projectSelectorJa = {
    selector: "Project セレクター",
    search: "Project を検索",
    empty: "Project が見つかりません",
    create: "新しい Project",
    creating: "新しい Project…",
    workInChat: "Chat で作業",
    current: "現在の Chat Project：{{project}}",
    chat: "Chat",
  } satisfies ProjectSelectorCopy;

export const projectSelectorFr = {
    selector: "Sélecteur de Project",
    search: "Rechercher des Projects",
    empty: "Aucun Project trouvé",
    create: "Nouveau Project",
    creating: "Nouveau Project…",
    workInChat: "Travailler dans le Chat",
    current: "Project du Chat actuel : {{project}}",
    chat: "Chat",
  } satisfies ProjectSelectorCopy;

export const projectSelectorEs = {
    selector: "Selector de Project",
    search: "Buscar Projects",
    empty: "No se encontraron Projects",
    create: "Nuevo Project",
    creating: "Nuevo Project…",
    workInChat: "Trabajar en el Chat",
    current: "Project actual del Chat: {{project}}",
    chat: "Chat",
  } satisfies ProjectSelectorCopy;

export function projectSelectorCopy(locale: string): ProjectSelectorCopy {
  switch (locale) {
    case "zh-CN": return projectSelectorZhCn;
    case "ja": return projectSelectorJa;
    case "fr": return projectSelectorFr;
    case "es": return projectSelectorEs;
    default: return projectSelectorEn;
  }
}
