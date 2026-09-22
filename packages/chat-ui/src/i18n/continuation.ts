/**
 * [INPUT]: Depends on the host locale.
 * [OUTPUT]: Provides five-language Fork and imported-history continuation labels shared by desktop and Web.
 * [POS]: Shared desktop/Web transcript boundary copy.
 */
const en = {
  fork: "⑂ Continued from chat", unavailable: "The original message is unavailable",
  imported: "⑂ Continued from imported history",
  importedChanged: "⑂ Continued from imported history · the source has changed",
  importedMissing: "⑂ Continued from imported history · the source is gone",
};
type Copy = { [K in keyof typeof en]: string };
const copies: Record<string, Copy> = {
  en,
  zh: { fork: "⑂ 续自上游 Chat", unavailable: "原始消息暂不可用",
    imported: "⑂ 续自导入的历史", importedChanged: "⑂ 续自导入的历史 · 来源已变化", importedMissing: "⑂ 续自导入的历史 · 来源已不在" },
  ja: { fork: "⑂ 元のチャットから継続", unavailable: "元のメッセージを利用できません",
    imported: "⑂ 取り込んだ履歴から継続", importedChanged: "⑂ 取り込んだ履歴から継続 · 元の記録は変更されました", importedMissing: "⑂ 取り込んだ履歴から継続 · 元の記録はもうありません" },
  fr: { fork: "⑂ Suite du chat", unavailable: "Le message d’origine est indisponible",
    imported: "⑂ Suite de l’historique importé", importedChanged: "⑂ Suite de l’historique importé · la source a changé", importedMissing: "⑂ Suite de l’historique importé · la source a disparu" },
  es: { fork: "⑂ Continuado desde el chat", unavailable: "El mensaje original no está disponible",
    imported: "⑂ Continuado desde el historial importado", importedChanged: "⑂ Continuado desde el historial importado · la fuente ha cambiado", importedMissing: "⑂ Continuado desde el historial importado · la fuente ya no está" },
};
export function continuationCopy(locale: string) { return copies[locale.toLowerCase().split("-")[0]!] ?? en; }
