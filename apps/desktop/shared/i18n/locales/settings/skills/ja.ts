/**
 * [INPUT]: Depends on the settingsSkillsEn structural type
 * [OUTPUT]: Provides settingsSkillsJa, the Japanese Settings › Skills catalog
 * [POS]: Japanese leaf of shared/i18n/locales/settings/skills; loaded on demand by the matching top-level locale
 */

import type { settingsSkillsEn } from "./en";

export const settingsSkillsJa: typeof settingsSkillsEn = {
  tabs: { skills: "Skills", extensions: "拡張" }, refresh: "Skills を更新", importTitle: "Skills を追加",
  description: "個人 Library に一度取り込むと、有効な Skill をすべての対応会話で使えます。",
  back: "戻る", localFolder: "ローカルフォルダー", chooseFolder: "フォルダーを選択…", importPrimary: "すべて取り込む", importSelected: "{{count}} 件を取り込んで有効化",
  backend: { codex: "Codex", claude: "Claude", kimi: "Kimi", opencode: "OpenCode" },
  sourceKind: { "local-folder": "ローカル", adopted: "取り込み済み", extension: "拡張" },
  selectSkill: "{{name}} を選択", enable: "有効化", disable: "無効化", delete: "削除", gotoPackage: "拡張を表示",
  batch: { selected: "{{count}} 件選択", done: "完了" },
  emptyTitle: "個人 Library に Skill はまだありません", emptyScanning: "インストール済み Agent の Skill を検索中…",
  emptyLead: "既存の Agent に {{count}} 個の Skill が見つかりました。一度取り込めば、すべての対応会話で使えます。",
  emptyNothingHint: "取り込める Skill がありません。拡張を導入するか、ローカルフォルダーを選んでください。",
  readOnly: "Skill 管理は読み取り専用です",
  budget: "{{count}} 件有効 · セッション一覧約 {{size}}（Library の有効項目から推定）", search: "Skills を検索", noMatches: "一致する Skill はありません。",
  confirmDeleteTitle: "Skills を削除しますか？", confirmDeleteBody: "個人 Library から {{count}} 件を完全に削除します。", confirmDeleteAction: "削除",
  footerImport: "既存の Skill を取り込む →", footerManage: "Skills を管理",
  contentState: { downloading: "ダウンロード中…", missing: "この端末にはありません" },
  noticeSlugConflict: "別の端末で名前が変わりました",
  error: { failed: "Skill の操作に失敗しました。再試行してください。" },
  reason: {
    "missing-skill-md": "SKILL.md がありません", "invalid-frontmatter": "SKILL.md のメタデータが無効です", "invalid-name": "Skill 名が無効です",
    "skill-md-too-large": "SKILL.md が大きすぎます", "too-many-directories": "ネストしたフォルダーが多すぎます", "too-many-candidates": "候補が多すぎます",
    symlink: "シンボリックリンクは使えません", "unsafe-path": "Skill フォルダー外へのパスです", "not-a-directory": "フォルダーではありません",
    unreadable: "フォルダーを読めません", missing: "フォルダーがありません", changed: "読み取り中に変更されました", timeout: "検索がタイムアウトしました",
    "source-gone": "ソースを利用できません", "postcondition-changed": "操作中に状態が変わりました", "acquisition-failed": "取り込みに失敗しました",
    "ref-invalid": "Skill 参照が無効です", unknown: "状態を確認できません",
  },
};
