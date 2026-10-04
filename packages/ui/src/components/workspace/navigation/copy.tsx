/**
 * [INPUT]: The host-selected product locale.
 * [OUTPUT]: Shared sidebar empty-state and pagination copy in five languages.
 * [POS]: Localized presentation vocabulary shared by browser and native sidebar adapters.
 */
const messages = {
  en: { chatsEmpty: "Click + to start a chat", more: "Show more" },
  "zh-CN": { chatsEmpty: "点击 + 开始聊天", more: "显示更多" },
  ja: { chatsEmpty: "+ を押してチャットを開始", more: "もっと見る" },
  fr: {
    chatsEmpty: "Cliquez sur + pour démarrer un chat",
    more: "Afficher plus",
  },
  es: { chatsEmpty: "Pulsa + para iniciar un chat", more: "Mostrar más" },
};
export function workspaceNavigationCopy(locale: string) {
  return messages[locale as keyof typeof messages] ?? messages.en;
}
