/**
 * [INPUT]: No runtime dependencies; consumed by the five root locale catalogs
 * [OUTPUT]: Provides five languages for Settings › Keyboard shortcuts (labels/hints per ShortcutId, recorder copy, capture errors, conflict tooltip, editor-keys notes)
 * [POS]: Keyboard-shortcuts feature catalog of shared/i18n/locales/settings; key glyphs (⌘/Ctrl) are rendered by code, not translated here
 */

export const settingsShortcutsEn = {
  title: "Product shortcuts",
  description:
    "Click a shortcut to record a new key combination. Shortcuts sharing the same keys show a warning; scoped shortcuts may legitimately share keys.",
  labels: {
    search: "Open command palette",
    newChat: "New chat",
    settings: "Open settings",
    saveInstructions: "Save instructions",
    findInFile: "Find in instructions",
    toggleSidebar: "Toggle sidebar",
    findInChat: "Find in chat",
  },
  hints: {
    saveInstructions: "Only in the Personalization editor",
    findInFile: "Only in the Personalization editor",
    findInChat: "Only in the chat transcript",
  },
  disabled: "Disabled",
  recordingPlaceholder: "Press new keys…",
  recordingHint: "Esc to cancel",
  editAria: "Change the {{name}} shortcut",
  disableAria: "Disable the {{name}} shortcut",
  resetAria: "Reset the {{name}} shortcut to its default",
  restoreDefaults: "Restore defaults",
  conflictWith: "Uses the same keys as {{name}}",
  errors: {
    needsModifier: "Include {{mod}} in the combination",
    altReserved: "Alt/Option combinations are reserved for the system",
    reservedCombo: "This combination is reserved by the app or system",
    unsupportedKey: "Use a letter, number, punctuation, or F1–F12",
  },
  saveFailed: "Failed to save the shortcut",
  restoreFailed: "Failed to restore default shortcuts",
  editorTitle: "Editor keys",
  editorDescription:
    "Fixed keys in the message composer. They follow platform conventions and cannot be rebound.",
  editor: {
    send: "Send message",
    newline: "Insert a newline",
    undo: "Undo and redo in the composer",
  },
};

type SettingsShortcutsCatalog = typeof settingsShortcutsEn;

export const settingsShortcutsZhCN: SettingsShortcutsCatalog = {
  title: "产品快捷键",
  description:
    "点击快捷键即可录制新的组合键。相同组合键的快捷键会显示警告；分属不同作用域的快捷键允许共用按键。",
  labels: {
    search: "打开命令面板",
    newChat: "新建会话",
    settings: "打开设置",
    saveInstructions: "保存指令",
    findInFile: "在指令中查找",
    toggleSidebar: "开关侧栏",
    findInChat: "在会话中查找",
  },
  hints: {
    saveInstructions: "仅在个性化指令编辑页生效",
    findInFile: "仅在个性化指令编辑页生效",
    findInChat: "仅在会话记录中生效",
  },
  disabled: "已停用",
  recordingPlaceholder: "按下新组合键…",
  recordingHint: "Esc 取消",
  editAria: "修改「{{name}}」的快捷键",
  disableAria: "停用「{{name}}」的快捷键",
  resetAria: "把「{{name}}」的快捷键恢复为默认",
  restoreDefaults: "恢复默认",
  conflictWith: "与「{{name}}」使用相同按键",
  errors: {
    needsModifier: "组合键需要包含 {{mod}}",
    altReserved: "Alt/Option 组合保留给系统使用",
    reservedCombo: "该组合键已被应用或系统占用",
    unsupportedKey: "请使用字母、数字、标点或 F1–F12",
  },
  saveFailed: "快捷键保存失败",
  restoreFailed: "恢复默认快捷键失败",
  editorTitle: "编辑器按键",
  editorDescription: "输入框内的固定按键。它们遵循平台惯例，不可改绑。",
  editor: {
    send: "发送消息",
    newline: "插入换行",
    undo: "在输入框中撤销与重做",
  },
};

export const settingsShortcutsJa: SettingsShortcutsCatalog = {
  title: "プロダクトショートカット",
  description:
    "ショートカットをクリックすると新しいキーの組み合わせを記録できます。同じキーを共有するショートカットには警告が表示されます。スコープが異なるショートカットはキーを共有できます。",
  labels: {
    search: "コマンドパレットを開く",
    newChat: "新しいチャット",
    settings: "設定を開く",
    saveInstructions: "指示を保存",
    findInFile: "指示内を検索",
    toggleSidebar: "サイドバーの切り替え",
    findInChat: "チャット内を検索",
  },
  hints: {
    saveInstructions: "パーソナライズ編集ページのみ",
    findInFile: "パーソナライズ編集ページのみ",
    findInChat: "チャット履歴のみ",
  },
  disabled: "無効",
  recordingPlaceholder: "新しいキーを押してください…",
  recordingHint: "Esc でキャンセル",
  editAria: "「{{name}}」のショートカットを変更",
  disableAria: "「{{name}}」のショートカットを無効化",
  resetAria: "「{{name}}」のショートカットを既定に戻す",
  restoreDefaults: "既定に戻す",
  conflictWith: "「{{name}}」と同じキーを使用しています",
  errors: {
    needsModifier: "組み合わせに {{mod}} を含めてください",
    altReserved: "Alt/Option の組み合わせはシステム予約です",
    reservedCombo: "この組み合わせはアプリまたはシステムで予約済みです",
    unsupportedKey: "英数字・記号・F1–F12 を使用してください",
  },
  saveFailed: "ショートカットの保存に失敗しました",
  restoreFailed: "既定のショートカットへの復元に失敗しました",
  editorTitle: "エディターキー",
  editorDescription:
    "メッセージ入力欄の固定キーです。プラットフォームの慣例に従い、変更できません。",
  editor: {
    send: "メッセージを送信",
    newline: "改行を挿入",
    undo: "入力欄で元に戻す・やり直す",
  },
};

export const settingsShortcutsFr: SettingsShortcutsCatalog = {
  title: "Raccourcis du produit",
  description:
    "Cliquez sur un raccourci pour enregistrer une nouvelle combinaison. Les raccourcis partageant les mêmes touches affichent un avertissement ; des raccourcis à portées différentes peuvent légitimement partager des touches.",
  labels: {
    search: "Ouvrir la palette de commandes",
    newChat: "Nouvelle discussion",
    settings: "Ouvrir les réglages",
    saveInstructions: "Enregistrer les instructions",
    findInFile: "Rechercher dans les instructions",
    toggleSidebar: "Afficher/masquer la barre latérale",
    findInChat: "Rechercher dans la discussion",
  },
  hints: {
    saveInstructions: "Uniquement dans l’éditeur de personnalisation",
    findInFile: "Uniquement dans l’éditeur de personnalisation",
    findInChat: "Uniquement dans la transcription de la discussion",
  },
  disabled: "Désactivé",
  recordingPlaceholder: "Appuyez sur les nouvelles touches…",
  recordingHint: "Échap pour annuler",
  editAria: "Modifier le raccourci « {{name}} »",
  disableAria: "Désactiver le raccourci « {{name}} »",
  resetAria: "Rétablir le raccourci par défaut de « {{name}} »",
  restoreDefaults: "Rétablir les valeurs par défaut",
  conflictWith: "Utilise les mêmes touches que « {{name}} »",
  errors: {
    needsModifier: "Incluez {{mod}} dans la combinaison",
    altReserved: "Les combinaisons Alt/Option sont réservées au système",
    reservedCombo: "Cette combinaison est réservée par l’application ou le système",
    unsupportedKey: "Utilisez une lettre, un chiffre, une ponctuation ou F1–F12",
  },
  saveFailed: "Échec de l’enregistrement du raccourci",
  restoreFailed: "Échec du rétablissement des raccourcis par défaut",
  editorTitle: "Touches de l’éditeur",
  editorDescription:
    "Touches fixes du compositeur de messages. Elles suivent les conventions de la plateforme et ne peuvent pas être réaffectées.",
  editor: {
    send: "Envoyer le message",
    newline: "Insérer un saut de ligne",
    undo: "Annuler et rétablir dans le compositeur",
  },
};

export const settingsShortcutsEs: SettingsShortcutsCatalog = {
  title: "Atajos del producto",
  description:
    "Haz clic en un atajo para grabar una nueva combinación de teclas. Los atajos que comparten las mismas teclas muestran una advertencia; atajos de distintos ámbitos pueden compartir teclas legítimamente.",
  labels: {
    search: "Abrir la paleta de comandos",
    newChat: "Nuevo chat",
    settings: "Abrir ajustes",
    saveInstructions: "Guardar instrucciones",
    findInFile: "Buscar en las instrucciones",
    toggleSidebar: "Mostrar/ocultar barra lateral",
    findInChat: "Buscar en el chat",
  },
  hints: {
    saveInstructions: "Solo en el editor de personalización",
    findInFile: "Solo en el editor de personalización",
    findInChat: "Solo en la transcripción del chat",
  },
  disabled: "Desactivado",
  recordingPlaceholder: "Pulsa las nuevas teclas…",
  recordingHint: "Esc para cancelar",
  editAria: "Cambiar el atajo de «{{name}}»",
  disableAria: "Desactivar el atajo de «{{name}}»",
  resetAria: "Restablecer el atajo de «{{name}}» a su valor predeterminado",
  restoreDefaults: "Restablecer valores predeterminados",
  conflictWith: "Usa las mismas teclas que «{{name}}»",
  errors: {
    needsModifier: "Incluye {{mod}} en la combinación",
    altReserved: "Las combinaciones con Alt/Option están reservadas para el sistema",
    reservedCombo: "Esta combinación está reservada por la aplicación o el sistema",
    unsupportedKey: "Usa una letra, un número, un signo de puntuación o F1–F12",
  },
  saveFailed: "No se pudo guardar el atajo",
  restoreFailed: "No se pudieron restablecer los atajos predeterminados",
  editorTitle: "Teclas del editor",
  editorDescription:
    "Teclas fijas del compositor de mensajes. Siguen las convenciones de la plataforma y no se pueden reasignar.",
  editor: {
    send: "Enviar mensaje",
    newline: "Insertar un salto de línea",
    undo: "Deshacer y rehacer en el compositor",
  },
};
