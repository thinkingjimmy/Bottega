/**
 * [INPUT]: No runtime dependencies; defines five isomorphic locale objects for Project Settings
 * [OUTPUT]: Provides projectSettingsEn/ZhCN/Ja/Fr/Es catalogs, including exact-Project Tools scope and bridge-unavailable copy
 * [POS]: Feature catalog for Project Settings routes, tabs, scope disclosures, and instruction/skill/tool states
 */

export const projectSettingsEn = {
  entry: "Project settings",
  open: "Open project settings",
  title: "{{name}} settings",
  tabs: { general: "General", personalization: "Personalization", skills: "Skills", extensions: "Extensions", tools: "Tools" },
  general: {
    sectionBasics: "Basics", name: "Name and appearance", renameAction: "Rename", appearanceAria: "Change Project appearance",
    memory: "Memory", memoryDisabled: "Memory service is disabled", memoryPaused: "Memory is paused", memoryUnavailable: "Service unavailable", memoryScoped: "This Project has an independent memory scope", memoryShared: "Memory is shared by chat or personal scope; this Project has no separate scope", memoryDelivering: "Imported memory is being delivered…", memoryManage: "Manage Memory",
    history: "History import", historyHint: "Import compatible external Agent history for this Project.",
    appsSection: "Available Apps", appsManagedByApp: "This App Project manages capabilities from its App page.",
    baseSection: "Base", baseEmpty: "This Project does not have a Base yet", baseCreate: "Create Base", baseOpen: "Open", baseSummary: "Project Base", baseLoading: "Loading Project Base",
    danger: "Danger zone", archiveHint: "Archive this Project and its members.", detachHint: "Remove the local Project record without deleting its external folder.", appLifecycleHint: "This App Project follows its App lifecycle. Delete the App from the Apps page."
  },
  instructions: {
    section: "Project instructions", description: "Edit the instruction files read by Agents in this Project workspace.", pointerHint: "This file points to AGENTS.md and usually does not need direct editing.", noWorkspace: "Choose a workspace from the Project row menu first.", bridgeMissing: "Project Personalization is unavailable in this environment.", appReadOnly: "App Project instruction files are read-only because the App generation owns their content.", appEditGuide: "Open the App page to continue in an App Edit conversation.", workspaceChanged: "The Project workspace changed. The disk baseline was refreshed; your draft was preserved.", loading: "Loading Project instructions", saveFailed: "Project instruction save failed", outsideWorkspace: "This instruction file resolves outside the Project workspace and cannot be read or changed.", appManaged: "App Project instructions are managed by the App generation."
  },
  skills: {
    section: "Callable Project Skills", scopeNote: "Project Skills follow this workspace; manage the inherited global library in Settings › Skills.", runtimeNote: "This list contains Skills callable through `$` in the product. Agent terminals may use different native discovery rules.", inheritedGroup: "Inherited global Skills ({{count}})", empty: "No callable Project Skills", emptyHint: "Place a skill at {{dir}}/.agents/skills/<name>/SKILL.md, then click Refresh.", refresh: "Refresh", search: "Search Skills", noWorkspace: "No Project workspace selected", noWorkspaceHint: "Choose a workspace to add Project Skills. Global and Extension Skills remain visible below.", loadFailed: "Project Skills could not be loaded.", badge: { repo: "Project", user: "User", system: "System", admin: "Admin", extension: "Extension" }
  },
  extensions: { scopeNote: "Install an Extension into this Project and its Skills become available only to conversations in this Project. Other Projects are unaffected." },
  tools: {
    scopeNote: "Changes here affect only “{{name}}”; unchanged items inherit global defaults.",
    bridgeMissing: "Project tool settings are unavailable in this environment.",
  }
};

export const projectSettingsZhCN = {
  entry: "Project 设置", open: "打开 Project 设置", title: "{{name}} 设置",
  tabs: { general: "通用", personalization: "个性化", skills: "Skills", extensions: "扩展", tools: "工具" },
  general: {
    sectionBasics: "基本信息", name: "名称与外观", renameAction: "重命名", appearanceAria: "更改 Project 外观",
    memory: "记忆", memoryDisabled: "记忆服务未启用", memoryPaused: "记忆已暂停", memoryUnavailable: "服务不可用", memoryScoped: "本 Project 拥有独立记忆域", memoryShared: "记忆按会话或个人域共享，Project 不单独分域", memoryDelivering: "导入记忆交付中…", memoryManage: "管理记忆",
    history: "History 导入", historyHint: "为本 Project 导入兼容的外部 Agent 历史。",
    appsSection: "可用的 App", appsManagedByApp: "此 App Project 的能力授权在 App 页面管理。",
    baseSection: "Base", baseEmpty: "此 Project 还没有 Base", baseCreate: "创建 Base", baseOpen: "打开", baseSummary: "Project Base", baseLoading: "正在加载 Project Base",
    danger: "危险区", archiveHint: "归档此 Project 及其成员。", detachHint: "移除本机 Project 记录，不删除外部目录。", appLifecycleHint: "App Project 的生命周期随 App；请在 Apps 页删除该 App。"
  },
  instructions: {
    section: "Project 指令", description: "编辑各 Agent 在此 Project 工作目录读取的指令文件。", pointerHint: "此文件指向 AGENTS.md，通常无需直接编辑。", noWorkspace: "请先在侧栏 Project 行菜单中选择工作目录。", bridgeMissing: "当前环境无法使用 Project 个性化桥。", appReadOnly: "App Project 指令由 App generation 管理，因此只读。", appEditGuide: "请打开 App 页面，在 App Edit 会话中继续。", workspaceChanged: "Project 工作目录已更换。磁盘基线已刷新，你的草稿仍保留。", loading: "正在加载 Project 指令", saveFailed: "Project 指令保存失败", outsideWorkspace: "此指令文件的真身位于 Project 工作目录之外，无法读取或修改。", appManaged: "App Project 指令由 App generation 管理。"
  },
  skills: {
    section: "Project 可调用 Skills", scopeNote: "Project Skills 随工作目录走；继承的全局库请在设置 › Skills 管理。", runtimeNote: "本清单仅表示产品内可通过 `$` 调用的 Skills；各 Agent 终端的原生发现口径可能不同。", inheritedGroup: "继承的全局 Skills（{{count}}）", empty: "没有可调用的 Project Skill", emptyHint: "把技能放进 {{dir}}/.agents/skills/<名称>/SKILL.md，然后点击刷新。", refresh: "刷新", search: "搜索 Skills", noWorkspace: "尚未选择 Project 工作目录", noWorkspaceHint: "选择工作目录后可添加 Project Skills；全局与扩展 Skills 仍显示在下方。", loadFailed: "Project Skills 加载失败。", badge: { repo: "Project", user: "用户", system: "系统", admin: "管理员", extension: "扩展" }
  },
  extensions: { scopeNote: "把扩展装到本 Project 后，它的 Skills 只对本 Project 会话生效，不影响其它 Project。" },
  tools: {
    scopeNote: "此处改动仅影响“{{name}}”；未覆盖的项目继续继承全局默认值。",
    bridgeMissing: "当前环境无法使用 Project 工具设置。",
  }
};

export const projectSettingsJa = {
  entry: "Project 設定", open: "Project 設定を開く", title: "{{name}} の設定",
  tabs: { general: "一般", personalization: "パーソナライズ", skills: "Skills", extensions: "拡張", tools: "ツール" },
  general: { sectionBasics: "基本情報", name: "名前と外観", renameAction: "名前を変更", appearanceAria: "Project の外観を変更", memory: "Memory", memoryDisabled: "Memory サービスは無効です", memoryPaused: "Memory は一時停止中です", memoryUnavailable: "サービスを利用できません", memoryScoped: "この Project には独立した Memory スコープがあります", memoryShared: "Memory は Chat または個人スコープで共有されます", memoryDelivering: "インポートした Memory を配信中…", memoryManage: "Memory を管理", history: "History インポート", historyHint: "外部 Agent の履歴をこの Project に取り込みます。", appsSection: "利用可能な Apps", appsManagedByApp: "この App Project の権限は App ページで管理します。", baseSection: "Base", baseEmpty: "この Project にはまだ Base がありません", baseCreate: "Base を作成", baseOpen: "開く", baseSummary: "Project Base", baseLoading: "Project Base を読み込み中", danger: "危険な操作", archiveHint: "この Project とメンバーをアーカイブします。", detachHint: "外部フォルダーを削除せずローカル記録を外します。", appLifecycleHint: "App Project は App のライフサイクルに従います。Apps ページで削除してください。" },
  instructions: { section: "Project 指示", description: "Agent がこのワークスペースで読む指示ファイルを編集します。", pointerHint: "このファイルは AGENTS.md を参照します。通常は直接編集不要です。", noWorkspace: "まず Project 行メニューでワークスペースを選択してください。", bridgeMissing: "Project Personalization を利用できません。", appReadOnly: "App generation が所有するため App Project の指示は読み取り専用です。", appEditGuide: "App ページの App Edit 会話を開いてください。", workspaceChanged: "Project のワークスペースが変更されました。下書きは保持されています。", loading: "Project 指示を読み込み中", saveFailed: "Project 指示の保存に失敗しました", outsideWorkspace: "指示ファイルが Project 外を参照しているため利用できません。", appManaged: "App Project の指示は App generation が管理します。" },
  skills: { section: "呼び出し可能な Project Skills", scopeNote: "Project Skills はワークスペースに従います。グローバルライブラリは設定 › Skills で管理します。", runtimeNote: "この一覧は製品内で `$` から呼べる Skills です。Agent 端末の検出規則とは異なる場合があります。", inheritedGroup: "継承したグローバル Skills（{{count}}）", empty: "呼び出し可能な Project Skill はありません", emptyHint: "{{dir}}/.agents/skills/<name>/SKILL.md に配置して更新してください。", refresh: "更新", search: "Skills を検索", noWorkspace: "Project ワークスペースが未選択です", noWorkspaceHint: "ワークスペースを選ぶと Project Skills を追加できます。グローバルと拡張 Skills は下に表示されます。", loadFailed: "Project Skills を読み込めませんでした。", badge: { repo: "Project", user: "ユーザー", system: "システム", admin: "管理", extension: "拡張" } },
  extensions: { scopeNote: "この Project に拡張をインストールすると、その Skills はこの Project の会話だけで利用でき、他の Project には影響しません。" },
  tools: { scopeNote: "ここでの変更は「{{name}}」だけに適用され、未変更の項目はグローバル既定値を継承します。", bridgeMissing: "この環境では Project のツール設定を利用できません。" }
};

export const projectSettingsFr = {
  entry: "Paramètres du Project", open: "Ouvrir les paramètres du Project", title: "Paramètres de {{name}}", tabs: { general: "Général", personalization: "Personnalisation", skills: "Skills", extensions: "Extensions", tools: "Outils" },
  general: { sectionBasics: "Informations", name: "Nom et apparence", renameAction: "Renommer", appearanceAria: "Modifier l’apparence du Project", memory: "Memory", memoryDisabled: "Le service Memory est désactivé", memoryPaused: "Memory est en pause", memoryUnavailable: "Service indisponible", memoryScoped: "Ce Project possède un espace Memory indépendant", memoryShared: "Memory est partagé par Chat ou profil personnel", memoryDelivering: "Distribution de la Memory importée…", memoryManage: "Gérer Memory", history: "Import History", historyHint: "Importer l’historique Agent externe compatible.", appsSection: "Apps disponibles", appsManagedByApp: "Les autorisations de cet App Project se gèrent depuis la page App.", baseSection: "Base", baseEmpty: "Ce Project n’a pas encore de Base", baseCreate: "Créer une Base", baseOpen: "Ouvrir", baseSummary: "Project Base", baseLoading: "Chargement de la Project Base", danger: "Zone dangereuse", archiveHint: "Archiver ce Project et ses membres.", detachHint: "Retirer l’enregistrement local sans supprimer le dossier externe.", appLifecycleHint: "Cet App Project suit le cycle de son App. Supprimez l’App depuis la page Apps." },
  instructions: { section: "Instructions du Project", description: "Modifier les fichiers lus par les Agents dans ce Project.", pointerHint: "Ce fichier pointe vers AGENTS.md et ne nécessite généralement pas d’édition.", noWorkspace: "Choisissez d’abord un dossier depuis le menu du Project.", bridgeMissing: "La personnalisation du Project est indisponible.", appReadOnly: "Les instructions d’un App Project sont en lecture seule car la génération App les possède.", appEditGuide: "Ouvrez la page App et poursuivez dans une conversation App Edit.", workspaceChanged: "Le dossier du Project a changé. Le brouillon est conservé.", loading: "Chargement des instructions", saveFailed: "Échec de l’enregistrement", outsideWorkspace: "Ce fichier pointe hors du dossier du Project.", appManaged: "Les instructions sont gérées par la génération App." },
  skills: { section: "Project Skills appelables", scopeNote: "Les Project Skills suivent ce dossier ; gérez la bibliothèque globale dans Paramètres › Skills.", runtimeNote: "Cette liste contient les Skills appelables via `$` dans le produit ; les terminaux Agent peuvent différer.", inheritedGroup: "Skills globaux hérités ({{count}})", empty: "Aucun Project Skill appelable", emptyHint: "Placez un Skill dans {{dir}}/.agents/skills/<nom>/SKILL.md puis actualisez.", refresh: "Actualiser", search: "Rechercher des Skills", noWorkspace: "Aucun dossier Project sélectionné", noWorkspaceHint: "Choisissez un dossier pour ajouter des Project Skills. Les Skills globaux et d’extension restent visibles ci-dessous.", loadFailed: "Impossible de charger les Project Skills.", badge: { repo: "Project", user: "Utilisateur", system: "Système", admin: "Admin", extension: "Extension" } },
  extensions: { scopeNote: "Installez une Extension dans ce Project : ses Skills ne seront disponibles que dans les conversations de ce Project, sans affecter les autres." },
  tools: { scopeNote: "Les changements ici affectent uniquement « {{name}} » ; les éléments inchangés héritent des valeurs globales.", bridgeMissing: "Les réglages d’outils du Project sont indisponibles dans cet environnement." }
};

export const projectSettingsEs = {
  entry: "Ajustes del Project", open: "Abrir ajustes del Project", title: "Ajustes de {{name}}", tabs: { general: "General", personalization: "Personalización", skills: "Skills", extensions: "Extensiones", tools: "Herramientas" },
  general: { sectionBasics: "Información básica", name: "Nombre y apariencia", renameAction: "Renombrar", appearanceAria: "Cambiar apariencia del Project", memory: "Memory", memoryDisabled: "El servicio Memory está desactivado", memoryPaused: "Memory está en pausa", memoryUnavailable: "Servicio no disponible", memoryScoped: "Este Project tiene un ámbito Memory independiente", memoryShared: "Memory se comparte por Chat o ámbito personal", memoryDelivering: "Entregando Memory importada…", memoryManage: "Gestionar Memory", history: "Importar History", historyHint: "Importa historial externo compatible de Agent.", appsSection: "Apps disponibles", appsManagedByApp: "Los permisos de este App Project se gestionan en la página App.", baseSection: "Base", baseEmpty: "Este Project aún no tiene Base", baseCreate: "Crear Base", baseOpen: "Abrir", baseSummary: "Project Base", baseLoading: "Cargando Project Base", danger: "Zona de peligro", archiveHint: "Archiva este Project y sus miembros.", detachHint: "Quita el registro local sin borrar la carpeta externa.", appLifecycleHint: "Este App Project sigue el ciclo de su App. Elimina la App desde Apps." },
  instructions: { section: "Instrucciones del Project", description: "Edita los archivos que leen los Agents en este Project.", pointerHint: "Este archivo apunta a AGENTS.md y normalmente no requiere edición.", noWorkspace: "Primero elige una carpeta desde el menú del Project.", bridgeMissing: "La personalización del Project no está disponible.", appReadOnly: "Las instrucciones de App Project son de solo lectura porque pertenecen a la generación App.", appEditGuide: "Abre la página App y continúa en una conversación App Edit.", workspaceChanged: "Cambió la carpeta del Project. Se conservó el borrador.", loading: "Cargando instrucciones", saveFailed: "No se pudieron guardar las instrucciones", outsideWorkspace: "Este archivo apunta fuera de la carpeta del Project.", appManaged: "La generación App gestiona estas instrucciones." },
  skills: { section: "Project Skills invocables", scopeNote: "Los Project Skills siguen esta carpeta; gestiona la biblioteca global en Ajustes › Skills.", runtimeNote: "Esta lista contiene Skills invocables mediante `$` en el producto; los terminales Agent pueden diferir.", inheritedGroup: "Skills globales heredados ({{count}})", empty: "No hay Project Skills invocables", emptyHint: "Coloca un Skill en {{dir}}/.agents/skills/<nombre>/SKILL.md y actualiza.", refresh: "Actualizar", search: "Buscar Skills", noWorkspace: "No hay carpeta de Project seleccionada", noWorkspaceHint: "Elige una carpeta para añadir Project Skills. Los Skills globales y de extensiones siguen visibles abajo.", loadFailed: "No se pudieron cargar los Project Skills.", badge: { repo: "Project", user: "Usuario", system: "Sistema", admin: "Admin", extension: "Extensión" } },
  extensions: { scopeNote: "Instala una extensión en este Project y sus Skills solo estarán disponibles en las conversaciones de este Project, sin afectar a los demás." },
  tools: { scopeNote: "Los cambios aquí solo afectan a «{{name}}»; los elementos sin cambios heredan los valores globales.", bridgeMissing: "Los ajustes de herramientas del Project no están disponibles en este entorno." }
};
