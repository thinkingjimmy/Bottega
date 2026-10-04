/**
 * [INPUT]: Depends on the English Bottega Dock key set.
 * [OUTPUT]: Provides ja Bottega Dock copy using macOS's Japanese names (Dock, Finder, ダウンロード, ゴミ箱, システム設定).
 * [POS]: system-dock locale slice mounted as `systemDock` by the Japanese root catalog.
 */
import type { systemDockEn } from "./en";

export const systemDockJa: typeof systemDockEn = {
  presence: {
    retentionOffTitle: "バックグラウンド動作をオフにしますか？",
    retentionOffBody: "Bottega Dock はオンです。バックグラウンド動作をオフにすると、最後の Bottega ウインドウを閉じたときに Bottega が終了し、Bottega Dock も閉じてシステムの Dock に戻ります。",
    retentionOffConfirm: "オフにする",
  },
  settings: { title: "Dock" },
};
