/**
 * [INPUT]: dependence when not in operation; The first is the installation of five local directories
 * [OUTPUT]: Provides Onboarding in five languages to guide text
 * [POS]: Onboarding feature catalog of shared/i18n/locales; step/blurb/heading/description Four sub-tables are selected by the guide step to remove the id key, blocked only by one Agent stepView no longer carries a regular Chinese scale
 */

/* ============================================================
 * 产品名不进目录。
 *
 * 「Bottega」是标识不是文案，它的单一真相源是 src/lib/brand.ts 的
 * PRODUCT_NAME。目录里只留 {{product}} 这个洞，视图取那一处填进来——
 * 否则改一次名要在五份目录里各改一遍，而且必然漏。
 * ============================================================ */
export const onboardingEn = {
  stepDone: " (done)", stepTodo: " (not done)",
  step: { "chat-home": "Data location", agent: "Agent", skills: "Skills", memory: "Memory" },
  blurb: { "chat-home": "Pick a folder on this Mac", agent: "Sign in to any official CLI", skills: "Bring your existing Skills", memory: "Turn it on now or later" },
  heading: { "chat-home": "Where should {{product}} keep your files?", agent: "Verify a local Agent", skills: "Build your personal Skills Library", memory: "Long-term memory" },
  blocked: { agent: "Sign in to at least one Agent to continue" },
  optional: "Optional", back: "Back", next: "Continue", start: "Get started",
  description: { "chat-home": "Chats, projects, and App files all stay on this Mac, inside the folder you pick. You can move it later in Settings.", agent: "One ready Agent is enough to start. Credentials and usage stay with each official CLI.", skills: "Import once, then use enabled Skills from every compatible conversation.", memory: "Let Agents reuse preferences and conclusions across Chats in one Project. The inventory stays on this Mac; extraction may be sent to the model service you configure." },
  skillsScanning: "Looking for existing Skills…", skillsFound: "Found {{count}} Skills in your existing Agents · Import them to use from every compatible conversation", skillsDone: "Your personal Skills Library is ready", skillsHint: "You can enable, disable, import, or delete Skills later in Settings › Skills.", skillsImportAll: "Import all and enable", skillsSkip: "Skip", skillsUpdateFailed: "Could not update Skills onboarding",
  chatHome: { unconfigured: "Chats, projects, and App files all live here.", ready: "Chats, projects, and App files live here; you can change it anytime." },
  chatHomeUnset: "Not chosen yet", change: "Change…", choose: "Choose folder…",
  agentAutoRecheck: "{{product}} re-checks whenever this window comes back to the front.",
  agentActionHint: "Each action opens the official CLI in your terminal.",
  memoryOn: "On", memoryOff: "Off",
  memoryEnabled: "Settings › Memory shows its activity and gaps.", memoryDisabled: "Install the local memory service and confirm the privacy disclosure once; recall and extraction begin after that.",
  memoryAction: "Set up memory", memorySkip: "Skipping is fine — you can turn this on any time in Settings › Memory.",
};
type OnboardingCatalog = typeof onboardingEn;
export const onboardingZhCN: OnboardingCatalog = {
  stepDone: "（已完成）", stepTodo: "（未完成）",
  step: { "chat-home": "数据位置", agent: "Agent", skills: "Skills", memory: "长期记忆" },
  blurb: { "chat-home": "在本机选一个目录", agent: "登录任一官方 CLI", skills: "导入已有 Skills", memory: "现在或以后再开" },
  heading: { "chat-home": "{{product}} 的文件放在哪里？", agent: "验证本机 Agent", skills: "建立你的个人 Skills Library", memory: "长期记忆" },
  blocked: { agent: "至少登录一个 Agent 才能继续" },
  optional: "可选", back: "上一步", next: "继续", start: "开始使用",
  description: { "chat-home": "所有 chat、项目与 App 文件都留在本机，存放在你选定的目录里。之后可以在 Settings 中更改。", agent: "任一后端就绪即可开始；凭证与用量始终由各家官方 CLI 管理。", skills: "只需导入一次，即可在所有兼容会话中使用已启用的 Skill。", memory: "让 Agent 在同一 Project 内跨 Chat 复用偏好与结论。记忆库存留在本机，提取内容可能发送到你配置的模型服务。" },
  skillsScanning: "正在查找已有 Skill…", skillsFound: "在你已有的 Agent 里发现 {{count}} 个 Skill · 导入后即可在所有兼容会话中使用", skillsDone: "你的个人 Skills Library 已就绪", skillsHint: "之后可在 Settings › Skills 中启用、停用、导入或删除。", skillsImportAll: "全部导入并启用", skillsSkip: "跳过", skillsUpdateFailed: "更新 Skills 引导状态失败",
  chatHome: { unconfigured: "chat、项目与 App 文件都会存放在这里。", ready: "chat、项目与 App 文件都存放在这里，之后可随时更改。" },
  chatHomeUnset: "尚未选择", change: "更改…", choose: "选择目录…",
  agentAutoRecheck: "每次窗口重新回到前台，{{product}} 都会自动复检。",
  agentActionHint: "每个动作都会在你的终端里打开对应的官方 CLI。",
  memoryOn: "已启用", memoryOff: "未启用",
  memoryEnabled: "可在 Settings › Memory 查看运行观测与缺口。", memoryDisabled: "需要先安装本机记忆服务并完成一次隐私披露确认，之后才会开始召回与提取。",
  memoryAction: "去设置记忆", memorySkip: "跳过也没关系——随时可以在 Settings › Memory 打开。",
};
export const onboardingJa: OnboardingCatalog = {
  stepDone: "（完了）", stepTodo: "（未完了）",
  step: { "chat-home": "データの保存先", agent: "Agent", skills: "Skills", memory: "長期メモリー" },
  blurb: { "chat-home": "この Mac のフォルダーを選ぶ", agent: "いずれかの公式 CLI にログイン", skills: "既存の Skills を取り込む", memory: "今でも後でも構いません" },
  heading: { "chat-home": "{{product}} のファイルはどこに置きますか？", agent: "ローカル Agent を検証", skills: "個人用 Skills Library を作成", memory: "長期メモリー" },
  blocked: { agent: "Agent を 1 つ以上ログインすると次へ進めます" },
  optional: "任意", back: "戻る", next: "次へ", start: "使い始める",
  description: { "chat-home": "chat・project・App のファイルはすべてこの Mac の、指定したフォルダーに残ります。後から Settings で変更できます。", agent: "いずれかのバックエンドが使えれば開始できます。認証情報と使用量は各公式 CLI が管理します。", skills: "一度取り込めば、有効な Skill をすべての対応会話で使えます。", memory: "同じ Project 内の Chat をまたいで好みや結論を再利用できます。在庫はこの Mac に残り、抽出内容は設定したモデルサービスへ送信される場合があります。" },
  skillsScanning: "既存の Skill を検索中…", skillsFound: "既存の Agent に {{count}} 個の Skill が見つかりました · 取り込むとすべての対応会話で使えます", skillsDone: "個人用 Skills Library の準備ができました", skillsHint: "後から Settings › Skills で有効化、無効化、取り込み、削除ができます。", skillsImportAll: "すべて取り込んで有効化", skillsSkip: "スキップ", skillsUpdateFailed: "Skills の案内状態を更新できませんでした",
  chatHome: { unconfigured: "chat、project、App のファイルがここに保存されます。", ready: "chat、project、App のファイルはここに保存されます。後からいつでも変更できます。" },
  chatHomeUnset: "未選択", change: "変更…", choose: "フォルダーを選択…",
  agentAutoRecheck: "ウィンドウが再び前面に戻るたびに {{product}} が自動で再確認します。",
  agentActionHint: "各操作はターミナルで対応する公式 CLI を開きます。",
  memoryOn: "オン", memoryOff: "オフ",
  memoryEnabled: "Settings › Memory で稼働状況と欠落を確認できます。", memoryDisabled: "ローカルのメモリーサービスを導入し、プライバシー開示を一度確認すると、想起と抽出が始まります。",
  memoryAction: "メモリーを設定", memorySkip: "スキップしても問題ありません。Settings › Memory でいつでも有効にできます。",
};
export const onboardingFr: OnboardingCatalog = {
  stepDone: " (terminé)", stepTodo: " (à faire)",
  step: { "chat-home": "Emplacement", agent: "Agent", skills: "Skills", memory: "Mémoire" },
  blurb: { "chat-home": "Choisissez un dossier sur ce Mac", agent: "Connectez-vous à une CLI officielle", skills: "Importez vos Skills existants", memory: "Maintenant ou plus tard" },
  heading: { "chat-home": "Où {{product}} doit-il conserver vos fichiers ?", agent: "Vérifier un Agent local", skills: "Créez votre Skills Library personnelle", memory: "Mémoire à long terme" },
  blocked: { agent: "Connectez-vous à au moins un Agent pour continuer" },
  optional: "Facultatif", back: "Retour", next: "Continuer", start: "Commencer",
  description: { "chat-home": "Tous les fichiers de chat, de project et d’App restent sur ce Mac, dans le dossier que vous choisissez. Vous pourrez en changer plus tard dans Settings.", agent: "Un seul backend prêt suffit pour démarrer ; identifiants et consommation restent gérés par chaque CLI officielle.", skills: "Importez une fois, puis utilisez les Skills activés dans chaque conversation compatible.", memory: "Laissez les Agents réutiliser préférences et conclusions entre les Chats d’un même Project. L’inventaire reste sur ce Mac ; l’extraction peut être envoyée au service de modèle que vous configurez." },
  skillsScanning: "Recherche des Skills existants…", skillsFound: "{{count}} Skills trouvés dans vos Agents existants · Importez-les pour les utiliser dans chaque conversation compatible", skillsDone: "Votre Skills Library personnelle est prête", skillsHint: "Vous pourrez ensuite activer, désactiver, importer ou supprimer des Skills dans Settings › Skills.", skillsImportAll: "Tout importer et activer", skillsSkip: "Ignorer", skillsUpdateFailed: "Impossible de mettre à jour l’accueil Skills",
  chatHome: { unconfigured: "Les fichiers de chat, de project et d’App seront enregistrés ici.", ready: "Les fichiers de chat, de project et d’App sont ici ; vous pouvez en changer à tout moment." },
  chatHomeUnset: "Pas encore choisi", change: "Modifier…", choose: "Choisir un dossier…",
  agentAutoRecheck: "{{product}} revérifie dès que cette fenêtre revient au premier plan.",
  agentActionHint: "Chaque action ouvre la CLI officielle correspondante dans votre terminal.",
  memoryOn: "Activée", memoryOff: "Désactivée",
  memoryEnabled: "Settings › Memory en montre l’activité et les lacunes.", memoryDisabled: "Installez le service de mémoire local et confirmez une fois la divulgation de confidentialité ; le rappel et l’extraction démarrent ensuite.",
  memoryAction: "Configurer la mémoire", memorySkip: "Vous pouvez passer : la mémoire s’active à tout moment dans Settings › Memory.",
};
export const onboardingEs: OnboardingCatalog = {
  stepDone: " (hecho)", stepTodo: " (pendiente)",
  step: { "chat-home": "Ubicación", agent: "Agent", skills: "Skills", memory: "Memoria" },
  blurb: { "chat-home": "Elige una carpeta en este Mac", agent: "Inicia sesión en una CLI oficial", skills: "Importa tus Skills existentes", memory: "Ahora o más adelante" },
  heading: { "chat-home": "¿Dónde debe guardar {{product}} tus archivos?", agent: "Verificar un Agent local", skills: "Crea tu Skills Library personal", memory: "Memoria a largo plazo" },
  blocked: { agent: "Inicia sesión en al menos un Agent para continuar" },
  optional: "Opcional", back: "Atrás", next: "Continuar", start: "Empezar",
  description: { "chat-home": "Todos los archivos de chat, project y App permanecen en este Mac, en la carpeta que elijas. Puedes cambiarla más tarde en Settings.", agent: "Basta con un backend listo para empezar; las credenciales y el consumo los gestiona cada CLI oficial.", skills: "Importa una vez y usa los Skills activados en todas las conversaciones compatibles.", memory: "Deja que los Agents reutilicen preferencias y conclusiones entre los Chats de un mismo Project. El inventario permanece en este Mac; la extracción puede enviarse al servicio de modelo que configures." },
  skillsScanning: "Buscando Skills existentes…", skillsFound: "Se encontraron {{count}} Skills en tus Agents existentes · Impórtalos para usarlos en todas las conversaciones compatibles", skillsDone: "Tu Skills Library personal está lista", skillsHint: "Luego podrás activar, desactivar, importar o eliminar Skills en Settings › Skills.", skillsImportAll: "Importar todo y activar", skillsSkip: "Omitir", skillsUpdateFailed: "No se pudo actualizar la bienvenida de Skills",
  chatHome: { unconfigured: "Los archivos de chat, project y App se guardarán aquí.", ready: "Los archivos de chat, project y App se guardan aquí; puedes cambiarlo cuando quieras." },
  chatHomeUnset: "Sin elegir", change: "Cambiar…", choose: "Elegir carpeta…",
  agentAutoRecheck: "{{product}} vuelve a comprobarlo cada vez que esta ventana pasa al frente.",
  agentActionHint: "Cada acción abre la CLI oficial correspondiente en tu terminal.",
  memoryOn: "Activada", memoryOff: "Desactivada",
  memoryEnabled: "Settings › Memory muestra su actividad y sus huecos.", memoryDisabled: "Instala el servicio de memoria local y confirma una vez la divulgación de privacidad; después empiezan el recuerdo y la extracción.",
  memoryAction: "Configurar memoria", memorySkip: "Puedes omitirlo: actívala cuando quieras en Settings › Memory.",
};
