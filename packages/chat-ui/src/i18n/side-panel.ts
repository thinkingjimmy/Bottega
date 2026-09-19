/**
 * [INPUT]: Five-language desktop panel vocabulary and browser-specific capability states.
 * [OUTPUT]: Typed sidePanelCopy for shells, catalogs, Base retargeting, subagents and image previews.
 * [POS]: Shared panel presentation vocabulary for desktop and Web hosts.
 */
const en = {
  "open": "Open side panel",
  "close": "Close panel",
  "back": "Back to conversation",
  "resize": "Resize side panel",
  "resizeHint": "Drag or use arrow keys to resize",
  "loadingBase": "Loading Base…",
  "resolveFailed": "Could not resolve the Base",
  "projectBase": "Project",
  "basePromoted": "This conversation’s Base is now App or Project data.",
  "desktopOnly": "Use in the desktop app",
  "openFull": "Open full Base",
  "create": "Create Base",
  "createFailed": "Could not create Base. Try again.",
  "subagentsEmpty": "No subagents yet",
  "subagentsEmptyWindow": "No subagents in the loaded history",
  "importedUnavailable": "This part of the history does not provide this data.",
  "archivedNotice": "Archived",
  "restore": "Restore",
  "add": "Add panel",
  "allOpen": "All panels are open",
  "closeTab": "Close tab",
  "closeNamed": "Close {name} tab",
  "openNamed": "Open {name}",
  "unavailableNamed": "{name} unavailable: {reason}",
  "tabs": "Side panel tabs",
  "retry": "Retry",
  "more": "More Base actions",
  "baseChanged": "This conversation’s Base changed to {name}. Your edits are preserved.",
  "noBase": "No Base",
  "save": "Save",
  "discard": "Discard edits",
  "keep": "Keep viewing the previous Base",
  "generatingTitle": "Generating title",
  "catalog": {
    "base": {
      "label": "Base",
      "hint": "Collect structured data created by this conversation"
    },
    "subagents": {
      "label": "Subagents",
      "hint": "View subagent responsibilities and execution details"
    },
    "browser": {
      "label": "Browser",
      "hint": "Open a page that shares your signed-in session with the Agent"
    },
    "app": {
      "label": "App",
      "hint": "Add any installed App and configure access before opening its tab"
    },
    "image": {
      "label": "Image",
      "hint": "View conversation images"
    }
  },
  "active": "Active",
  "done": "Done",
  "detailUnavailable": "Details unavailable",
  "detailLimit": "This subagent’s details are outside the available history.",
  "starting": "Starting…",
  "noTranscript": "No transcript",
  "backToList": "Back to subagents",
  "preview": "Image preview",
  "previewNamed": "Preview {name}",
  "zoom": "Zoom",
  "download": "Download",
  "loadingImage": "Loading image…",
  "imageUnavailable": "This image is unavailable."
};
export type SidePanelCopy = typeof en;
const zh: SidePanelCopy = {
  "open": "打开侧边面板",
  "close": "关闭面板",
  "back": "返回对话",
  "resize": "调整侧边面板宽度",
  "resizeHint": "拖动或使用方向键调宽",
  "loadingBase": "正在加载 Base…",
  "resolveFailed": "无法确定此对话的 Base",
  "projectBase": "Project",
  "basePromoted": "此对话的 Base 已转为 App/Project 数据。",
  "desktopOnly": "在桌面应用中使用",
  "openFull": "打开完整 Base",
  "create": "创建 Base",
  "createFailed": "无法创建 Base，请重试。",
  "subagentsEmpty": "没有子代理",
  "subagentsEmptyWindow": "当前窗口内没有子代理",
  "importedUnavailable": "该段历史未提供此类数据。",
  "archivedNotice": "已归档",
  "restore": "恢复",
  "add": "添加面板",
  "allOpen": "所有面板均已打开",
  "closeTab": "关闭标签",
  "closeNamed": "关闭 {name} 标签",
  "openNamed": "打开 {name}",
  "unavailableNamed": "{name} 不可用：{reason}",
  "tabs": "侧边面板标签",
  "retry": "重试",
  "more": "更多 Base 操作",
  "baseChanged": "此对话的 Base 已变为 {name}，当前编辑已保留。",
  "noBase": "无 Base",
  "save": "保存",
  "discard": "放弃编辑",
  "keep": "继续查看旧库",
  "generatingTitle": "正在生成标题",
  "catalog": {
    "base": {
      "label": "Base",
      "hint": "结构化收集本次对话沉淀的数据"
    },
    "subagents": {
      "label": "子代理",
      "hint": "查看子代理的分工与执行详情"
    },
    "browser": {
      "label": "浏览器",
      "hint": "新开网页，Agent 与你共用登录态"
    },
    "app": {
      "label": "App",
      "hint": "添加任意已安装 App，设置授权后打开标签页"
    },
    "image": {
      "label": "图片",
      "hint": "查看会话图片"
    }
  },
  "active": "进行中",
  "done": "已完成",
  "detailUnavailable": "详情不可用",
  "detailLimit": "该子代理详情不在可用历史内。",
  "starting": "正在启动…",
  "noTranscript": "没有转录内容",
  "backToList": "返回子代理列表",
  "preview": "图片预览",
  "previewNamed": "预览 {name}",
  "zoom": "缩放",
  "download": "下载",
  "loadingImage": "正在加载图片…",
  "imageUnavailable": "此图片不可用。"
};
const ja: SidePanelCopy = {
  "open": "サイドパネルを開く",
  "close": "パネルを閉じる",
  "back": "会話に戻る",
  "resize": "パネルの幅を変更",
  "resizeHint": "ドラッグまたは矢印キーで幅を変更",
  "loadingBase": "Base を読み込み中…",
  "resolveFailed": "Base を確認できませんでした",
  "projectBase": "Project",
  "basePromoted": "この会話の Base は App または Project のデータになりました。",
  "desktopOnly": "デスクトップアプリで利用",
  "openFull": "Base を全画面で開く",
  "create": "Base を作成",
  "createFailed": "Base を作成できませんでした。再試行してください。",
  "subagentsEmpty": "サブエージェントはありません",
  "subagentsEmptyWindow": "読み込んだ履歴にサブエージェントはありません",
  "importedUnavailable": "この履歴にはこの種類のデータがありません。",
  "archivedNotice": "アーカイブ済み",
  "restore": "復元",
  "add": "パネルを追加",
  "allOpen": "すべてのパネルが開いています",
  "closeTab": "タブを閉じる",
  "closeNamed": "{name} タブを閉じる",
  "openNamed": "{name} を開く",
  "unavailableNamed": "{name} は利用できません：{reason}",
  "tabs": "サイドパネルのタブ",
  "retry": "再試行",
  "more": "Base のその他の操作",
  "baseChanged": "この会話の Base が {name} に変わりました。編集内容は保持されています。",
  "noBase": "Base なし",
  "save": "保存",
  "discard": "編集を破棄",
  "keep": "以前の Base を表示し続ける",
  "generatingTitle": "タイトルを生成中",
  "catalog": {
    "base": {
      "label": "Base",
      "hint": "この会話で生まれた構造化データを収集"
    },
    "subagents": {
      "label": "サブエージェント",
      "hint": "サブエージェントの分担と実行詳細を表示"
    },
    "browser": {
      "label": "ブラウザ",
      "hint": "Agent とログイン状態を共有するページを開く"
    },
    "app": {
      "label": "App",
      "hint": "インストール済みの App を追加し、アクセスを設定してからタブを開く"
    },
    "image": {
      "label": "画像",
      "hint": "会話の画像を表示"
    }
  },
  "active": "実行中",
  "done": "完了",
  "detailUnavailable": "詳細は利用できません",
  "detailLimit": "このサブエージェントの詳細は表示できる履歴の範囲外です。",
  "starting": "起動中…",
  "noTranscript": "記録なし",
  "backToList": "サブエージェント一覧に戻る",
  "preview": "画像プレビュー",
  "previewNamed": "{name} のプレビュー",
  "zoom": "ズーム",
  "download": "ダウンロード",
  "loadingImage": "画像を読み込み中…",
  "imageUnavailable": "この画像は利用できません。"
};
const fr: SidePanelCopy = {
  "open": "Ouvrir le panneau latéral",
  "close": "Fermer le panneau",
  "back": "Revenir à la conversation",
  "resize": "Redimensionner le panneau",
  "resizeHint": "Glissez ou utilisez les flèches",
  "loadingBase": "Chargement de Base…",
  "resolveFailed": "Impossible de trouver la Base",
  "projectBase": "Project",
  "basePromoted": "La Base de cette conversation appartient maintenant à une App ou un Project.",
  "desktopOnly": "Disponible dans l’application de bureau",
  "openFull": "Ouvrir la Base complète",
  "create": "Créer une Base",
  "createFailed": "Impossible de créer la Base. Réessayez.",
  "subagentsEmpty": "Aucun sous-agent",
  "subagentsEmptyWindow": "Aucun sous-agent dans l’historique chargé",
  "importedUnavailable": "Cette partie de l’historique ne fournit pas ces données.",
  "archivedNotice": "Archivée",
  "restore": "Restaurer",
  "add": "Ajouter un panneau",
  "allOpen": "Tous les panneaux sont ouverts",
  "closeTab": "Fermer l’onglet",
  "closeNamed": "Fermer l’onglet {name}",
  "openNamed": "Ouvrir {name}",
  "unavailableNamed": "{name} indisponible : {reason}",
  "tabs": "Onglets du panneau latéral",
  "retry": "Réessayer",
  "more": "Autres actions de Base",
  "baseChanged": "La Base de cette conversation est devenue {name}. Vos modifications sont conservées.",
  "noBase": "Aucune Base",
  "save": "Enregistrer",
  "discard": "Abandonner les modifications",
  "keep": "Continuer à voir l’ancienne Base",
  "generatingTitle": "Génération du titre",
  "catalog": {
    "base": {
      "label": "Base",
      "hint": "Collecter les données structurées produites par cette conversation"
    },
    "subagents": {
      "label": "Sous-agents",
      "hint": "Voir la répartition et les détails d’exécution des sous-agents"
    },
    "browser": {
      "label": "Navigateur",
      "hint": "Ouvrir une page partageant votre session connectée avec l’Agent"
    },
    "app": {
      "label": "App",
      "hint": "Ajoutez toute App installée et configurez l’accès avant d’ouvrir son onglet"
    },
    "image": {
      "label": "Image",
      "hint": "Voir les images de la conversation"
    }
  },
  "active": "En cours",
  "done": "Terminé",
  "detailUnavailable": "Détails indisponibles",
  "detailLimit": "Les détails de ce sous-agent sont hors de l’historique disponible.",
  "starting": "Démarrage…",
  "noTranscript": "Aucune transcription",
  "backToList": "Revenir aux sous-agents",
  "preview": "Aperçu de l’image",
  "previewNamed": "Aperçu de {name}",
  "zoom": "Zoom",
  "download": "Télécharger",
  "loadingImage": "Chargement de l’image…",
  "imageUnavailable": "Cette image est indisponible."
};
const es: SidePanelCopy = {
  "open": "Abrir panel lateral",
  "close": "Cerrar panel",
  "back": "Volver a la conversación",
  "resize": "Cambiar ancho del panel",
  "resizeHint": "Arrastra o usa las flechas",
  "loadingBase": "Cargando Base…",
  "resolveFailed": "No se pudo encontrar la Base",
  "projectBase": "Project",
  "basePromoted": "La Base de esta conversación ahora pertenece a una App o Project.",
  "desktopOnly": "Disponible en la aplicación de escritorio",
  "openFull": "Abrir Base completa",
  "create": "Crear Base",
  "createFailed": "No se pudo crear la Base. Inténtalo de nuevo.",
  "subagentsEmpty": "No hay subagentes",
  "subagentsEmptyWindow": "No hay subagentes en el historial cargado",
  "importedUnavailable": "Esta parte del historial no proporciona estos datos.",
  "archivedNotice": "Archivado",
  "restore": "Restaurar",
  "add": "Añadir panel",
  "allOpen": "Todos los paneles están abiertos",
  "closeTab": "Cerrar pestaña",
  "closeNamed": "Cerrar pestaña {name}",
  "openNamed": "Abrir {name}",
  "unavailableNamed": "{name} no disponible: {reason}",
  "tabs": "Pestañas del panel lateral",
  "retry": "Reintentar",
  "more": "Más acciones de Base",
  "baseChanged": "La Base de esta conversación cambió a {name}. Tus cambios están guardados.",
  "noBase": "Sin Base",
  "save": "Guardar",
  "discard": "Descartar cambios",
  "keep": "Seguir viendo la Base anterior",
  "generatingTitle": "Generando título",
  "catalog": {
    "base": {
      "label": "Base",
      "hint": "Recopila los datos estructurados creados por esta conversación"
    },
    "subagents": {
      "label": "Subagentes",
      "hint": "Consulta el reparto y los detalles de ejecución de los subagentes"
    },
    "browser": {
      "label": "Navegador",
      "hint": "Abre una página que comparte tu sesión iniciada con el Agent"
    },
    "app": {
      "label": "App",
      "hint": "Añade cualquier App instalada y configura el acceso antes de abrir su pestaña"
    },
    "image": {
      "label": "Imagen",
      "hint": "Ver imágenes de la conversación"
    }
  },
  "active": "En curso",
  "done": "Finalizado",
  "detailUnavailable": "Detalles no disponibles",
  "detailLimit": "Los detalles de este subagente están fuera del historial disponible.",
  "starting": "Iniciando…",
  "noTranscript": "Sin transcripción",
  "backToList": "Volver a subagentes",
  "preview": "Vista previa de imagen",
  "previewNamed": "Vista previa de {name}",
  "zoom": "Zoom",
  "download": "Descargar",
  "loadingImage": "Cargando imagen…",
  "imageUnavailable": "Esta imagen no está disponible."
};
export function sidePanelCopy(locale: string): SidePanelCopy { return locale.startsWith("zh") ? zh : locale.startsWith("ja") ? ja : locale.startsWith("fr") ? fr : locale.startsWith("es") ? es : en; }
