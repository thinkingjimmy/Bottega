/**
 * [INPUT]: Depends on no runtime modules; all five locale objects share one literal shape
 * [OUTPUT]: Provides five-language chat Skill failure, empty-response, and composer suggestion copy
 * [POS]: Locale authority for structured Skill failures and composer runtime states
 */

export const chatEn = {
  noText: "This turn returned no text.",
  skillControl: {
    capabilityChecking: "Plan capability is still being checked. Try again in a moment.",
    workspaceChanged: "The workspace changed. Try again.",
    planUnavailable: "The current Agent does not support Plan mode.",
    invalidated: "This Skill changed or was removed. Remove the chip and choose it again.",
  },
  skillFailure: {
    "ref-invalid": "This Skill is no longer available. Remove the chip and choose it again.",
    "requirement-blocked": "This Skill is not available for the current Agent or Plan mode.",
    "file-too-large": "This Skill is too large to load safely.",
    "changed-during-read": "This Skill changed while it was being loaded. Try again.",
    "plan-unsupported": "The current Agent does not support Plan mode.",
    "invalid-request": "The Skill request is invalid.",
    "staging-rejected": "The Skill could not be staged safely.",
    "package-invalid": "The Skill package is invalid.",
    unavailable: "Skills are temporarily unavailable.",
    conflict: "The Skills state changed. Refresh and try again.",
    "read-only": "Skills management is currently read-only.",
    failed: "The Skill operation failed. Try again.",
  },
  suggestions: {
    chats: "Chats",
    files: "Files",
    skills: "Skills",
    loadingChats: "Loading chats…",
    loadingSkills: "Loading Skills…",
    noChats: "No chats available",
    noSkills: "No Skills available",
    sectionDescription: "Handled by {{agent}}",
    historyDescription: "Imported {{agent}} conversation",
    hiddenSkills: "{{count}} more matching Skills are hidden. Refine your search.",
    filesTruncated: "Some repository files were not indexed. Enter a more specific query.",
  },
};

export const chatZhCN: typeof chatEn = {
  noText: "本轮没有返回文本。",
  skillControl: {
    capabilityChecking: "正在检查 Plan 能力，请稍候重试。",
    workspaceChanged: "Workspace 已切换，请重试。",
    planUnavailable: "当前 Agent 不支持 Plan 模式。",
    invalidated: "这个 Skill 已变更或被移除，请删除标签后重新选择。",
  },
  skillFailure: {
    "ref-invalid": "这个 Skill 已失效，请移除标签后重新选择。",
    "requirement-blocked": "当前 Agent 或 Plan 模式不能使用这个 Skill。",
    "file-too-large": "这个 Skill 体积过大，无法安全加载。",
    "changed-during-read": "Skill 在加载时发生变化，请重试。",
    "plan-unsupported": "当前 Agent 不支持 Plan 模式。",
    "invalid-request": "Skill 请求无效。",
    "staging-rejected": "无法安全暂存这个 Skill。",
    "package-invalid": "Skill 包无效。",
    unavailable: "Skills 暂时不可用。",
    conflict: "Skills 状态已变化，请刷新后重试。",
    "read-only": "Skills 管理当前为只读。",
    failed: "Skill 操作失败，请重试。",
  },
  suggestions: {
    chats: "聊天",
    files: "文件",
    skills: "Skills",
    loadingChats: "正在加载聊天…",
    loadingSkills: "正在加载 Skills…",
    noChats: "没有可用聊天",
    noSkills: "没有可用 Skill",
    sectionDescription: "由 {{agent}} 处理",
    historyDescription: "{{agent}} 导入会话",
    hiddenSkills: "另有 {{count}} 个匹配 Skill 未显示，请缩小搜索范围。",
    filesTruncated: "部分仓库文件未进入索引，请输入更精确的关键词。",
  },
};

export const chatJa: typeof chatEn = {
  noText: "このターンはテキストを返しませんでした。",
  skillControl: {
    capabilityChecking: "Plan 機能を確認中です。しばらくしてから再試行してください。",
    workspaceChanged: "ワークスペースが変わりました。再試行してください。",
    planUnavailable: "現在の Agent は Plan モードをサポートしていません。",
    invalidated: "この Skill は変更または削除されました。チップを削除して選び直してください。",
  },
  skillFailure: {
    "ref-invalid": "この Skill は利用できません。チップを削除して選び直してください。",
    "requirement-blocked": "現在の Agent または Plan モードではこの Skill を利用できません。",
    "file-too-large": "この Skill は大きすぎるため安全に読み込めません。",
    "changed-during-read": "読み込み中に Skill が変更されました。再試行してください。",
    "plan-unsupported": "現在の Agent は Plan モードをサポートしていません。",
    "invalid-request": "Skill リクエストが無効です。",
    "staging-rejected": "Skill を安全にステージできませんでした。",
    "package-invalid": "Skill パッケージが無効です。",
    unavailable: "Skills は一時的に利用できません。",
    conflict: "Skills の状態が変わりました。更新して再試行してください。",
    "read-only": "Skills 管理は現在読み取り専用です。",
    failed: "Skill 操作に失敗しました。再試行してください。",
  },
  suggestions: {
    chats: "チャット", files: "ファイル", skills: "Skills",
    loadingChats: "チャットを読み込み中…", loadingSkills: "Skills を読み込み中…",
    noChats: "利用できるチャットはありません", noSkills: "利用できる Skill はありません",
    sectionDescription: "{{agent}} が処理", historyDescription: "{{agent}} から取り込んだ会話",
    hiddenSkills: "一致する Skill がほかに {{count}} 件あります。検索を絞り込んでください。",
    filesTruncated: "一部のリポジトリファイルは索引されていません。検索を絞り込んでください。",
  },
};

export const chatFr: typeof chatEn = {
  noText: "Ce tour n’a renvoyé aucun texte.",
  skillControl: {
    capabilityChecking: "La capacité Plan est en cours de vérification. Réessayez dans un instant.",
    workspaceChanged: "L’espace de travail a changé. Réessayez.",
    planUnavailable: "L’Agent actuel ne prend pas en charge le mode Plan.",
    invalidated: "Ce Skill a changé ou a été supprimé. Retirez la puce et sélectionnez-le à nouveau.",
  },
  skillFailure: {
    "ref-invalid": "Ce Skill n’est plus disponible. Retirez la puce et sélectionnez-le à nouveau.",
    "requirement-blocked": "Ce Skill n’est pas disponible pour l’Agent ou le mode Plan actuel.",
    "file-too-large": "Ce Skill est trop volumineux pour être chargé en toute sécurité.",
    "changed-during-read": "Le Skill a changé pendant son chargement. Réessayez.",
    "plan-unsupported": "L’Agent actuel ne prend pas en charge le mode Plan.",
    "invalid-request": "La demande de Skill est invalide.",
    "staging-rejected": "Le Skill n’a pas pu être préparé en toute sécurité.",
    "package-invalid": "Le paquet Skill est invalide.",
    unavailable: "Les Skills sont temporairement indisponibles.",
    conflict: "L’état des Skills a changé. Actualisez puis réessayez.",
    "read-only": "La gestion des Skills est actuellement en lecture seule.",
    failed: "L’opération Skill a échoué. Réessayez.",
  },
  suggestions: {
    chats: "Conversations", files: "Fichiers", skills: "Skills",
    loadingChats: "Chargement des conversations…", loadingSkills: "Chargement des Skills…",
    noChats: "Aucune conversation disponible", noSkills: "Aucun Skill disponible",
    sectionDescription: "Géré par {{agent}}", historyDescription: "Conversation {{agent}} importée",
    hiddenSkills: "{{count}} Skills correspondants supplémentaires sont masqués. Affinez la recherche.",
    filesTruncated: "Certains fichiers n’ont pas été indexés. Précisez votre recherche.",
  },
};

export const chatEs: typeof chatEn = {
  noText: "Este turno no devolvió texto.",
  skillControl: {
    capabilityChecking: "Se está comprobando la capacidad de Plan. Inténtalo de nuevo en un momento.",
    workspaceChanged: "El espacio de trabajo cambió. Inténtalo de nuevo.",
    planUnavailable: "El Agent actual no admite el modo Plan.",
    invalidated: "Este Skill cambió o se eliminó. Quita el chip y selecciónalo de nuevo.",
  },
  skillFailure: {
    "ref-invalid": "Este Skill ya no está disponible. Quita el chip y selecciónalo de nuevo.",
    "requirement-blocked": "Este Skill no está disponible para el Agent o modo Plan actual.",
    "file-too-large": "Este Skill es demasiado grande para cargarlo de forma segura.",
    "changed-during-read": "El Skill cambió mientras se cargaba. Inténtalo de nuevo.",
    "plan-unsupported": "El Agent actual no admite el modo Plan.",
    "invalid-request": "La solicitud de Skill no es válida.",
    "staging-rejected": "No se pudo preparar el Skill de forma segura.",
    "package-invalid": "El paquete Skill no es válido.",
    unavailable: "Skills no está disponible temporalmente.",
    conflict: "El estado de Skills cambió. Actualiza e inténtalo de nuevo.",
    "read-only": "La gestión de Skills está en modo de solo lectura.",
    failed: "La operación de Skill falló. Inténtalo de nuevo.",
  },
  suggestions: {
    chats: "Chats", files: "Archivos", skills: "Skills",
    loadingChats: "Cargando chats…", loadingSkills: "Cargando Skills…",
    noChats: "No hay chats disponibles", noSkills: "No hay Skills disponibles",
    sectionDescription: "Gestionado por {{agent}}", historyDescription: "Conversación de {{agent}} importada",
    hiddenSkills: "Hay {{count}} Skills coincidentes más ocultos. Acota la búsqueda.",
    filesTruncated: "Algunos archivos no se indexaron. Escribe una búsqueda más específica.",
  },
};
