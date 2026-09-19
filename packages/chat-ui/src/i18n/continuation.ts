/**
 * [INPUT]: Depends on the host locale.
 * [OUTPUT]: Provides five-language Fork origin and unavailable-message labels shared by desktop and Web.
 * [POS]: Shared desktop/Web transcript boundary copy.
 */
const en = { fork: "⑂ Continued from chat", unavailable: "The original message is unavailable" };
type Copy = { [K in keyof typeof en]: string };
const copies: Record<string, Copy> = {
  en,
  zh: { fork: "⑂ 续自上游 Chat", unavailable: "原始消息暂不可用" },
  ja: { fork: "⑂ 元のチャットから継続", unavailable: "元のメッセージを利用できません" },
  fr: { fork: "⑂ Suite du chat", unavailable: "Le message d’origine est indisponible" },
  es: { fork: "⑂ Continuado desde el chat", unavailable: "El mensaje original no está disponible" },
};
export function continuationCopy(locale: string) { return copies[locale.toLowerCase().split("-")[0]!] ?? en; }
