/**
 * [INPUT]: dependence when not in operation; The first is the installation of five local directories
 * [OUTPUT]: Provides five languages for Settings › Extensions
 * [POS]: Extensions feature catalog of shared/i18n/locales/settings; Keep the original of the warehouse, component, App and diagnostic identifier
 */

export const settingsExtensionsEn = {
  page: {
    bridgeMissing: "Extension management is unavailable in this environment (IPC bridge missing)",
    admissionClosed:
      "An extension is converging to disabled: projection bindings are being revoked, shared artifacts released, sessions with old discovery snapshots restarted, and caches invalidated. New Agent sessions remain paused until convergence completes.",
    installedTitle: "Installed extensions",
    installedDescription:
      "Paste a GitHub repository homepage without choosing a family first. A root plugin.json becomes an Agent Plugin; otherwise skills/<name>/SKILL.md must exist. The product classifies the frozen commit, and every component is disabled after installation until you enable it.",
    installGithub: "Install from GitHub",
    family: {
      skillTitle: "Skill repositories",
      skillDescription: "Only the root skills/ subtree is materialized; MCP is not included.",
      pluginTitle: "Agent Plugins",
      pluginDescription:
        "The whole tree is packaged and may contain Skills and MCP servers. MCP component delivery is not available yet and will open in separate policy tiers.",
    },
    emptyTitle: "No extensions installed",
    emptyHint:
      "After installation, extensions appear under Skill repositories or Agent Plugins according to their detected format.",
    retainedTitle: "Uninstalled with data retained",
    retainedDescription:
      "Removing package code never deletes install-owned data implicitly. Permanent deletion is a separate action, and reinstalling the same repository cannot recover deleted data.",
    purgeData: "Permanently delete data",
    retainedCustody: "Custody is still active: {{custody}}",
    retainedEpochs: "{{count}} data epochs remain on this computer.",
  },
  install: {
    stage: {
      source: {
        title: "Add extension",
        description:
          "Paste a repository homepage without choosing a family. The system freezes a commit, then treats a root plugin.json as an Agent Plugin or a skills/<name>/SKILL.md tree as a Skill repository. Enable components individually after installation.",
        commit: "Continue",
        pending: "Resolving source…",
      },
      install: { title: "Confirm installation", commit: "Confirm install", pending: "Installing…" },
      update: { title: "Confirm update", commit: "Confirm update", pending: "Updating…" },
    },
    resolveFailed: "Failed to resolve source",
    installFailed: "Installation failed",
    summary: "{{url}} @ {{commit}} ({{files}} files / {{kilobytes}} KB)",
    repository: "Repository URL",
    repositoryHint:
      "Capabilities are shown only after resolving an immutable commit; nothing is written to the registry before confirmation. A repository already installed becomes a new generation of that installation.",
    back: "Back",
    disclosure: {
      format: "Detected format",
      pluginFormat:
        "Agent Plugin (root plugin.json): it will appear in the Agent Plugins group under Settings › Extensions.",
      skillFormat:
        "Skill repository (no plugin.json; only the skills/ subtree): it will appear in the Skill repositories group under Settings › Extensions.",
      scripts: "Executable scripts",
      none: "None",
      skill: "Skill {{name}}",
      allowedTools: "allowed-tools: {{tools}}",
      undeclared: "Not declared",
      mcp: "MCP {{serverId}} ({{transport}})",
      mcpUnavailable:
        "MCP component delivery is not available yet and will open in separate policy tiers. {{target}}",
      staticHeaders: "; static headers: {{headers}}",
      writeRoot: "Persistent data write root",
      writeRootRequired:
        "Includes a stdio server and needs an install-owned write root. A new generation uses its own data epoch and never writes alongside the old generation.",
      writeRootNone: "Not required",
      capabilityChange: "Capability changes from the previous generation",
      addedRemoved: "Added: {{added}} | removed: {{removed}}",
      noChange: "No changes",
      report: "Parser note",
      postUpdate: "State after update",
      postInstall: "State after install",
      reauthorize:
        "Capabilities expanded: the new generation starts disabled and every component must be enabled again. The immutable old generation continues serving Apps bound to it.",
      retainAuthorization:
        "Capabilities did not expand: current per-component settings are retained. The immutable old generation continues serving Apps bound to it.",
      defaultDisabled: "Disabled by default; enable each component separately.",
      migrateAria: "Migrate {{appId}} to the new generation",
      migrateDescription:
        "Currently bound to {{generation}}. Migration creates a new generation awaiting authorization; without migration, the App continues using the old generation.",
      migrateLabel: "Migrate App {{appId}}",
    },
  },
  package: {
    description:
      "{{admission}} · {{administration}} · global catalog {{catalog}} · App grants are independent · commit {{commit}}",
    admission: { valid: "Admitted", misconfigured: "Misconfigured" },
    administration: { active: "Administration active", "disable-pending": "Administrative disable converging", denied: "Administration denied" },
    catalog: { on: "on", off: "off" },
    checkUpdate: "Check for updates",
    disable: "Disable",
    cancelUninstall: "Cancel uninstall",
    uninstall: "Uninstall",
    enable: "Enable",
    mcpUnavailable: "MCP delivery is not available yet",
    eligibilityEntry: "{{backend}}: {{status}}",
    health: "health",
    healthEntry: "{{backend}}={{status}}",
    turnEffect: "effective this turn: view in the chat context",
    componentDescription: "{{kind}} · {{transport}}",
    kind: { skill: "Skill", "mcp-server": "MCP server" },
    generation: "Previous generation {{generation}}",
    generationBlocked: "Still bound precisely by {{count}} owners; retained immutable and addressable.",
    generationFree: "Unreferenced and eligible for a separate uninstall action.",
    done: "Complete",
    pending: "Pending",
    convergenceBlocked: "Convergence blocked",
    foreignCopy: "External copy {{projectionId}}",
    foreignCopyDetail:
      "{{componentIdentity}} was not written by the product. It can only be marked {{strength}} and must be handled manually; the product will not claim it was revoked.",
    uninstallBlocked: "Uninstall blocked",
    otherOwners: "Other owners",
    runtimeReferences: "Runtime references",
    runtimeReferencesDetail:
      "{{leases}} projection leases are outstanding; {{artifacts}} shared artifacts are still referenced and will not be removed.",
    custody: "Process / transport custody",
    migrate: "Migrate to new generation",
    migrateDescription:
      "Still bound precisely to {{generation}}. Migration refreezes with this reference closed: required becomes blocked, optional becomes degraded, and authorization is required again. Otherwise cancel uninstall and keep this disabled package installed.",
    retryUninstall: "Retry uninstall",
    convergenceStep: {
      "projection-binding-revoked": "Revoke product-managed projection bindings",
      "shared-artifacts-released": "Release shared artifacts by refcount",
      "product-sessions-drained": "Restart product sessions with old discovery snapshots",
      "discovery-cache-invalidated": "Invalidate discovery caches",
    },
    uninstallStep: {
      "durable-references-resolved": "Resolve durable references (reservations, App generations, and other owners)",
      "runtime-custody-drained": "Drain plan leases, projection leases, and process custody",
      "package-generations-removed": "Remove every package generation",
      "package-bytes-collected": "Collect unreferenced package bytes, excluding install-owned data",
    },
    strength: {
      "per-tool-enforced": "enforced per tool", "per-turn-enforced": "enforced per turn", "server-inclusion-only": "server inclusion only", "workspace-requested": "workspace requested", "backend-delegated": "delegated to backend", "unsupported-by-policy": "blocked by policy", unknown: "unknown",
    },
    exclusion: {
      "package-disabled": "package disabled", "package-disable-pending": "package disable pending", "package-generation-removal-pending": "generation removal pending", "component-disabled": "component disabled", "backend-capability-mismatch": "backend capability mismatch", "delivery-channel-unsupported": "delivery channel unsupported", "transport-unsupported": "transport unsupported", "projection-unavailable": "projection unavailable", "runtime-health-failed": "runtime health failed", "turn-policy-ineligible": "turn policy ineligible", "snapshot-materialization-failed": "snapshot materialization failed",
    },
    deliveryHealth: { healthy: "healthy", degraded: "degraded", unavailable: "unavailable", unknown: "unknown" },
  },
};

type SettingsExtensionsCatalog = typeof settingsExtensionsEn;

export const settingsExtensionsZhCN: SettingsExtensionsCatalog = {
  page: {
    bridgeMissing: "当前环境不支持扩展管理（IPC 桥缺席）",
    admissionClosed: "有扩展正在收敛停用：撤投影绑定、释放共享产物、重启持旧发现快照的会话并使缓存失效。收敛完成前不会启动新的 Agent 会话。",
    installedTitle: "已安装扩展",
    installedDescription: "粘贴 GitHub 仓库主页地址即可，不必先分辨它是哪一族：根有 plugin.json 收作 Agent Plugin，否则要有 skills/<名字>/SKILL.md。判型在冻结 commit 后由产品完成；装上默认停用，需要逐个 component 启用。",
    installGithub: "从 GitHub 安装",
    family: { skillTitle: "Skill 仓库", skillDescription: "只物化仓库根 skills/ 子树，不带 MCP。", pluginTitle: "Agent Plugins", pluginDescription: "整棵树进包，可同时携带 Skill 与 MCP server；MCP 组件交付按独立方案分档开放，当前尚不可用。" },
    emptyTitle: "还没有安装扩展", emptyHint: "装上之后按判定形态分成“Skill 仓库”与“Agent Plugins”两组。",
    retainedTitle: "已卸载但数据仍在", retainedDescription: "回收 package 代码从不顺手删除 install-owned 数据。彻底删除是独立、显式的动作；删掉之后，重新安装同一个仓库也拿不回它。", purgeData: "彻底删除数据", retainedCustody: "仍有未归零的 custody：{{custody}}", retainedEpochs: "{{count}} 个 data epoch 仍保留在本机。",
  },
  install: {
    stage: { source: { title: "添加扩展", description: "粘贴仓库主页地址即可，不必先分辨它是哪一族：系统先冻结 commit 再判型——根有 plugin.json 收作 Agent Plugin，否则要有 skills/<名字>/SKILL.md。安装后逐个 component 启用。", commit: "继续", pending: "正在解析来源…" }, install: { title: "安装前确认", commit: "确认安装", pending: "正在安装…" }, update: { title: "更新前确认", commit: "确认更新", pending: "正在更新…" } },
    resolveFailed: "解析来源失败", installFailed: "安装失败", summary: "{{url}} @ {{commit}}（{{files}} 个文件 / {{kilobytes}} KB）", repository: "仓库地址", repositoryHint: "解析为不可变 commit 后再展示能力，确认前不写入 registry。已装过的同一仓库会解析成这个安装的新一代。", back: "返回",
    disclosure: {
      format: "判定形态", pluginFormat: "Agent Plugin（根有 plugin.json）：确认后落在 Settings › 扩展 的“Agent Plugins”组。", skillFormat: "Skill 仓库（无 plugin.json，只取 skills/ 子树）：确认后落在 Settings › 扩展 的“Skill 仓库”组。", scripts: "可执行脚本", none: "无", skill: "Skill {{name}}", allowedTools: "allowed-tools：{{tools}}", undeclared: "未声明", mcp: "MCP {{serverId}}（{{transport}}）", mcpUnavailable: "MCP 组件交付将按独立方案分档开放，当前尚不可用。{{target}}", staticHeaders: "；静态 header：{{headers}}", writeRoot: "持久数据写根", writeRootRequired: "含 stdio server，需要 install-owned 写根；新一代使用独立 data epoch，不与旧代共写。", writeRootNone: "不需要", capabilityChange: "相对上一代的能力变化", addedRemoved: "新增：{{added}}｜移除：{{removed}}", noChange: "无变化", report: "解析提示", postUpdate: "更新后状态", postInstall: "安装后状态", reauthorize: "能力已扩大：新一代默认停用，每个 component 都要重新启用。旧一代保持不可变，仍服务已绑定它的 App。", retainAuthorization: "能力未扩大：沿用当前的逐项启用状态。旧一代保持不可变，仍服务已绑定它的 App。", defaultDisabled: "默认停用；每个 component 需要单独启用。", migrateAria: "迁移 {{appId}} 到新一代", migrateDescription: "当前绑定 {{generation}}。迁移会创建新的待授权 generation；不迁移则继续使用旧一代。", migrateLabel: "迁移 App {{appId}}",
    },
  },
  package: {
    description: "{{admission}} · {{administration}} · 全局目录{{catalog}} · App 授权独立 · commit {{commit}}", admission: { valid: "已准入", misconfigured: "配置有误" }, administration: { active: "管理状态正常", "disable-pending": "管理停用收敛中", denied: "管理状态已否决" }, catalog: { on: "已开", off: "已关" }, checkUpdate: "检查更新", disable: "停用", cancelUninstall: "放弃卸载", uninstall: "卸载", enable: "启用", mcpUnavailable: "MCP 组件交付当前尚不可用", eligibilityEntry: "{{backend}}：{{status}}", health: "健康", healthEntry: "{{backend}}={{status}}", turnEffect: "本轮生效：需在聊天上下文查看", componentDescription: "{{kind}} · {{transport}}", kind: { skill: "Skill", "mcp-server": "MCP server" }, generation: "上一代 {{generation}}", generationBlocked: "仍被 {{count}} 个持有者精确绑定，保持不可变、可寻址。", generationFree: "无人引用，可由独立卸载动作回收。", done: "已完成", pending: "待收敛", convergenceBlocked: "收敛受阻", foreignCopy: "外部副本 {{projectionId}}", foreignCopyDetail: "{{componentIdentity}} 不是产品写入的副本，只能标 {{strength}} 并由你手动处置；产品不会替它声称已撤销。", uninstallBlocked: "卸载受阻", otherOwners: "其它持有者", runtimeReferences: "运行期引用", runtimeReferencesDetail: "未归还的 projection lease {{leases}} 个；仍被引用的共享产物 {{artifacts}} 份（不回收）。", custody: "进程 / transport custody", migrate: "迁移到新一代", migrateDescription: "仍精确绑定 {{generation}}。迁移会在“该引用已关闭”的快照上重新冻结：required 变 blocked、optional 变 degraded，并需要重新授权。不迁移就放弃卸载，这个包保持已停用但仍安装。", retryUninstall: "重试卸载",
    convergenceStep: { "projection-binding-revoked": "撤销产品管理的投影绑定", "shared-artifacts-released": "按 refcount 释放共享产物", "product-sessions-drained": "重启持旧发现快照的产品会话", "discovery-cache-invalidated": "使发现缓存失效" },
    uninstallStep: { "durable-references-resolved": "解决 durable 引用（reservation / App 代 / 其它持有者）", "runtime-custody-drained": "等 plan lease、投影 lease 与进程 custody 归零", "package-generations-removed": "回收全部 package generation", "package-bytes-collected": "回收无人引用的包字节（不含 install-owned 数据）" },
    strength: { "per-tool-enforced": "逐工具强制", "per-turn-enforced": "逐轮强制", "server-inclusion-only": "整台 server 注入", "workspace-requested": "请求 workspace", "backend-delegated": "由 backend 代理", "unsupported-by-policy": "策略不支持", unknown: "未知" },
    exclusion: { "package-disabled": "package 已停用", "package-disable-pending": "package 正在停用", "package-generation-removal-pending": "generation 正在回收", "component-disabled": "component 未启用", "backend-capability-mismatch": "backend 能力不匹配", "delivery-channel-unsupported": "交付通道不支持", "transport-unsupported": "transport 不支持", "projection-unavailable": "投影不可用", "runtime-health-failed": "runtime 健康检查失败", "turn-policy-ineligible": "本轮策略不允许", "snapshot-materialization-failed": "快照物化失败" },
    deliveryHealth: { healthy: "健康", degraded: "降级", unavailable: "不可用", unknown: "未知" },
  },
};

export const settingsExtensionsJa: SettingsExtensionsCatalog = {
  page: {
    bridgeMissing: "この環境では拡張を管理できません（IPC bridge なし）", admissionClosed: "拡張を無効化する収束処理中です。投影の解除、共有成果物の解放、古い discovery snapshot を持つセッションの再起動、キャッシュ無効化が完了するまで新しい Agent セッションは開始しません。", installedTitle: "インストール済み拡張", installedDescription: "種類を選ばず GitHub リポジトリのホーム URL を貼り付けます。ルートに plugin.json があれば Agent Plugin、それ以外は skills/<名前>/SKILL.md が必要です。固定 commit を製品が判定し、インストール後は component ごとに有効化します。", installGithub: "GitHub からインストール", family: { skillTitle: "Skill リポジトリ", skillDescription: "ルートの skills/ サブツリーだけを取り込み、MCP は含みません。", pluginTitle: "Agent Plugins", pluginDescription: "ツリー全体をパッケージ化し、Skill と MCP server を含められます。MCP component の配信は現在利用できず、別のポリシー段階で開放されます。" }, emptyTitle: "拡張はまだありません", emptyHint: "インストール後、検出形式に応じて Skill リポジトリまたは Agent Plugins に表示されます。", retainedTitle: "アンインストール済み・データ保持中", retainedDescription: "package コードの削除は install-owned データを暗黙に消しません。完全削除は独立した操作で、削除後に同じリポジトリを再インストールしても復元できません。", purgeData: "データを完全に削除", retainedCustody: "custody が残っています：{{custody}}", retainedEpochs: "{{count}} 個の data epoch がこのコンピューターに残っています。",
  },
  install: {
    stage: { source: { title: "拡張を追加", description: "種類を選ばずリポジトリのホーム URL を貼り付けます。システムが commit を固定し、ルートの plugin.json を Agent Plugin、skills/<名前>/SKILL.md を Skill リポジトリとして判定します。インストール後は component ごとに有効化します。", commit: "続行", pending: "ソースを解決中…" }, install: { title: "インストールの確認", commit: "インストールを確認", pending: "インストール中…" }, update: { title: "更新の確認", commit: "更新を確認", pending: "更新中…" } }, resolveFailed: "ソースの解決に失敗しました", installFailed: "インストールに失敗しました", summary: "{{url}} @ {{commit}}（{{files}} ファイル / {{kilobytes}} KB）", repository: "リポジトリ URL", repositoryHint: "不変 commit の解決後に機能を表示し、確認までは registry に書きません。インストール済みの同じリポジトリは新しい generation になります。", back: "戻る",
    disclosure: { format: "検出形式", pluginFormat: "Agent Plugin（ルートに plugin.json）：Settings › 拡張の Agent Plugins グループに表示されます。", skillFormat: "Skill リポジトリ（plugin.json なし、skills/ のみ）：Settings › 拡張の Skill リポジトリに表示されます。", scripts: "実行可能スクリプト", none: "なし", skill: "Skill {{name}}", allowedTools: "allowed-tools：{{tools}}", undeclared: "未宣言", mcp: "MCP {{serverId}}（{{transport}}）", mcpUnavailable: "MCP component の配信は現在利用できず、別ポリシーで段階的に開放されます。{{target}}", staticHeaders: "；静的 header：{{headers}}", writeRoot: "永続データ書き込みルート", writeRootRequired: "stdio server を含むため install-owned 書き込みルートが必要です。新 generation は独立した data epoch を使います。", writeRootNone: "不要", capabilityChange: "前 generation からの機能変更", addedRemoved: "追加：{{added}}｜削除：{{removed}}", noChange: "変更なし", report: "解析メモ", postUpdate: "更新後の状態", postInstall: "インストール後の状態", reauthorize: "機能が拡大しました。新 generation は無効で始まり、component ごとに再有効化が必要です。旧 generation は不変のまま既存 App に提供されます。", retainAuthorization: "機能は拡大していません。現在の component 設定を引き継ぎ、旧 generation は既存 App に提供されます。", defaultDisabled: "初期状態は無効です。component ごとに有効化してください。", migrateAria: "{{appId}} を新 generation に移行", migrateDescription: "現在 {{generation}} に紐づいています。移行すると承認待ちの新 generation を作成し、移行しなければ旧 generation を使い続けます。", migrateLabel: "App {{appId}} を移行" },
  },
  package: {
    description: "{{admission}}・{{administration}}・グローバルカタログ {{catalog}}・App 権限は独立・commit {{commit}}", admission: { valid: "承認済み", misconfigured: "設定エラー" }, administration: { active: "管理状態は正常", "disable-pending": "管理無効化の収束中", denied: "管理状態は拒否" }, catalog: { on: "オン", off: "オフ" }, checkUpdate: "更新を確認", disable: "無効化", cancelUninstall: "アンインストールを中止", uninstall: "アンインストール", enable: "有効化", mcpUnavailable: "MCP 配信は現在利用できません", eligibilityEntry: "{{backend}}：{{status}}", health: "状態", healthEntry: "{{backend}}={{status}}", turnEffect: "このターンの有効性：Chat で確認", componentDescription: "{{kind}}・{{transport}}", kind: { skill: "Skill", "mcp-server": "MCP server" }, generation: "前 generation {{generation}}", generationBlocked: "{{count}} 所有者が正確に参照中のため、不変・参照可能なまま保持します。", generationFree: "参照がなく、独立したアンインストール操作で回収できます。", done: "完了", pending: "保留", convergenceBlocked: "収束がブロック", foreignCopy: "外部コピー {{projectionId}}", foreignCopyDetail: "{{componentIdentity}} は製品が書いたコピーではありません。{{strength}} とだけ表示し、手動で処理してください。製品は解除済みとは主張しません。", uninstallBlocked: "アンインストールがブロック", otherOwners: "他の所有者", runtimeReferences: "実行時参照", runtimeReferencesDetail: "未返却の projection lease が {{leases}} 件、参照中で削除しない共有成果物が {{artifacts}} 件あります。", custody: "プロセス / transport custody", migrate: "新 generation に移行", migrateDescription: "{{generation}} に正確に紐づいています。移行するとこの参照を閉じた snapshot で再固定し、required は blocked、optional は degraded となり再承認が必要です。移行しない場合はアンインストールを中止します。", retryUninstall: "アンインストールを再試行",
    convergenceStep: { "projection-binding-revoked": "製品管理の投影バインドを解除", "shared-artifacts-released": "refcount で共有成果物を解放", "product-sessions-drained": "古い discovery snapshot のセッションを再起動", "discovery-cache-invalidated": "discovery cache を無効化" }, uninstallStep: { "durable-references-resolved": "durable 参照を解決（reservation、App generation、他所有者）", "runtime-custody-drained": "plan lease、projection lease、process custody を解消", "package-generations-removed": "すべての package generation を削除", "package-bytes-collected": "install-owned データを除く未参照 package byte を回収" }, strength: { "per-tool-enforced": "ツール単位で強制", "per-turn-enforced": "ターン単位で強制", "server-inclusion-only": "server 全体のみ", "workspace-requested": "workspace 要求", "backend-delegated": "backend に委任", "unsupported-by-policy": "ポリシーで非対応", unknown: "不明" }, exclusion: { "package-disabled": "package 無効", "package-disable-pending": "package 無効化待ち", "package-generation-removal-pending": "generation 削除待ち", "component-disabled": "component 無効", "backend-capability-mismatch": "backend 機能不一致", "delivery-channel-unsupported": "配信チャネル非対応", "transport-unsupported": "transport 非対応", "projection-unavailable": "投影利用不可", "runtime-health-failed": "runtime 状態エラー", "turn-policy-ineligible": "ターンポリシー対象外", "snapshot-materialization-failed": "snapshot 生成失敗" }, deliveryHealth: { healthy: "正常", degraded: "低下", unavailable: "利用不可", unknown: "不明" },
  },
};

export const settingsExtensionsFr: SettingsExtensionsCatalog = {
  page: {
    bridgeMissing: "La gestion des extensions est indisponible dans cet environnement (bridge IPC absent)", admissionClosed: "Une extension converge vers l’état désactivé : révocation des projections, libération des artefacts, redémarrage des sessions avec un ancien snapshot et invalidation des caches. Aucun nouvel Agent ne démarre avant la fin.", installedTitle: "Extensions installées", installedDescription: "Collez l’URL GitHub sans choisir de famille. Un plugin.json à la racine devient un Agent Plugin ; sinon skills/<nom>/SKILL.md doit exister. Le produit classe le commit figé et chaque composant reste désactivé jusqu’à son activation.", installGithub: "Installer depuis GitHub", family: { skillTitle: "Dépôts de Skills", skillDescription: "Seul le sous-arbre skills/ de la racine est matérialisé, sans MCP.", pluginTitle: "Agent Plugins", pluginDescription: "L’arbre entier est empaqueté et peut contenir Skills et serveurs MCP. La livraison MCP n’est pas encore disponible et sera ouverte par paliers séparés." }, emptyTitle: "Aucune extension installée", emptyHint: "Après installation, les extensions apparaissent dans Dépôts de Skills ou Agent Plugins selon leur format détecté.", retainedTitle: "Désinstallées avec données conservées", retainedDescription: "Supprimer le code du package ne supprime jamais implicitement ses données. La suppression définitive est séparée et une réinstallation ne peut pas récupérer les données supprimées.", purgeData: "Supprimer définitivement les données", retainedCustody: "Custody encore active : {{custody}}", retainedEpochs: "{{count}} data epochs restent sur cet ordinateur.",
  },
  install: {
    stage: { source: { title: "Ajouter une extension", description: "Collez l’URL du dépôt sans choisir de famille. Le système fige un commit puis traite plugin.json comme Agent Plugin ou skills/<nom>/SKILL.md comme dépôt de Skills. Activez ensuite chaque composant.", commit: "Continuer", pending: "Résolution de la source…" }, install: { title: "Confirmer l’installation", commit: "Confirmer l’installation", pending: "Installation…" }, update: { title: "Confirmer la mise à jour", commit: "Confirmer la mise à jour", pending: "Mise à jour…" } }, resolveFailed: "Échec de résolution de la source", installFailed: "Échec de l’installation", summary: "{{url}} @ {{commit}} ({{files}} fichiers / {{kilobytes}} Ko)", repository: "URL du dépôt", repositoryHint: "Les capacités apparaissent après résolution d’un commit immuable ; rien n’est écrit dans le registre avant confirmation. Un dépôt déjà installé devient une nouvelle génération.", back: "Retour",
    disclosure: { format: "Format détecté", pluginFormat: "Agent Plugin (plugin.json à la racine) : affiché dans Agent Plugins sous Settings › Extensions.", skillFormat: "Dépôt de Skills (sans plugin.json, sous-arbre skills/ uniquement) : affiché dans Dépôts de Skills.", scripts: "Scripts exécutables", none: "Aucun", skill: "Skill {{name}}", allowedTools: "allowed-tools : {{tools}}", undeclared: "Non déclaré", mcp: "MCP {{serverId}} ({{transport}})", mcpUnavailable: "La livraison MCP n’est pas encore disponible et sera ouverte par paliers séparés. {{target}}", staticHeaders: " ; headers statiques : {{headers}}", writeRoot: "Racine d’écriture persistante", writeRootRequired: "Contient un serveur stdio et nécessite une racine install-owned. Chaque génération utilise son propre data epoch.", writeRootNone: "Non requise", capabilityChange: "Évolution des capacités", addedRemoved: "Ajout : {{added}} | retrait : {{removed}}", noChange: "Aucun changement", report: "Note d’analyse", postUpdate: "État après mise à jour", postInstall: "État après installation", reauthorize: "Les capacités augmentent : la nouvelle génération est désactivée et chaque composant doit être réactivé. L’ancienne génération immuable continue de servir les Apps liées.", retainAuthorization: "Les capacités n’augmentent pas : les réglages actuels sont conservés et l’ancienne génération continue de servir les Apps liées.", defaultDisabled: "Désactivée par défaut ; activez chaque composant.", migrateAria: "Migrer {{appId}} vers la nouvelle génération", migrateDescription: "Actuellement lié à {{generation}}. La migration crée une génération en attente d’autorisation ; sans migration, l’App garde l’ancienne.", migrateLabel: "Migrer l’App {{appId}}" },
  },
  package: {
    description: "{{admission}} · {{administration}} · catalogue global {{catalog}} · autorisations App indépendantes · commit {{commit}}", admission: { valid: "Admise", misconfigured: "Configuration incorrecte" }, administration: { active: "Administration active", "disable-pending": "Désactivation administrative en convergence", denied: "Administration refusée" }, catalog: { on: "activé", off: "désactivé" }, checkUpdate: "Rechercher une mise à jour", disable: "Désactiver", cancelUninstall: "Annuler la désinstallation", uninstall: "Désinstaller", enable: "Activer", mcpUnavailable: "Livraison MCP indisponible", eligibilityEntry: "{{backend}} : {{status}}", health: "santé", healthEntry: "{{backend}}={{status}}", turnEffect: "effectif ce tour : voir dans le Chat", componentDescription: "{{kind}} · {{transport}}", kind: { skill: "Skill", "mcp-server": "Serveur MCP" }, generation: "Génération précédente {{generation}}", generationBlocked: "Toujours liée précisément par {{count}} propriétaires ; conservée immuable et adressable.", generationFree: "Non référencée, récupérable par une désinstallation séparée.", done: "Terminé", pending: "En attente", convergenceBlocked: "Convergence bloquée", foreignCopy: "Copie externe {{projectionId}}", foreignCopyDetail: "{{componentIdentity}} n’a pas été écrit par le produit. Il peut seulement être marqué {{strength}} et doit être traité manuellement.", uninstallBlocked: "Désinstallation bloquée", otherOwners: "Autres propriétaires", runtimeReferences: "Références runtime", runtimeReferencesDetail: "{{leases}} leases de projection restent actives ; {{artifacts}} artefacts partagés sont encore référencés et ne seront pas supprimés.", custody: "Custody processus / transport", migrate: "Migrer vers la nouvelle génération", migrateDescription: "Toujours lié précisément à {{generation}}. La migration regèle la référence fermée : required devient blocked, optional devient degraded, avec nouvelle autorisation. Sinon annulez la désinstallation.", retryUninstall: "Réessayer la désinstallation",
    convergenceStep: { "projection-binding-revoked": "Révoquer les projections gérées", "shared-artifacts-released": "Libérer les artefacts par refcount", "product-sessions-drained": "Redémarrer les sessions avec anciens snapshots", "discovery-cache-invalidated": "Invalider les caches de découverte" }, uninstallStep: { "durable-references-resolved": "Résoudre les références durables", "runtime-custody-drained": "Vider les leases et custody runtime", "package-generations-removed": "Supprimer toutes les générations du package", "package-bytes-collected": "Récupérer les octets non référencés hors données install-owned" }, strength: { "per-tool-enforced": "imposé par outil", "per-turn-enforced": "imposé par tour", "server-inclusion-only": "serveur entier uniquement", "workspace-requested": "workspace demandé", "backend-delegated": "délégué au backend", "unsupported-by-policy": "bloqué par la politique", unknown: "inconnu" }, exclusion: { "package-disabled": "package désactivé", "package-disable-pending": "désactivation du package en attente", "package-generation-removal-pending": "suppression de génération en attente", "component-disabled": "composant désactivé", "backend-capability-mismatch": "capacité backend incompatible", "delivery-channel-unsupported": "canal de livraison incompatible", "transport-unsupported": "transport incompatible", "projection-unavailable": "projection indisponible", "runtime-health-failed": "échec de santé runtime", "turn-policy-ineligible": "tour non éligible", "snapshot-materialization-failed": "échec de matérialisation du snapshot" }, deliveryHealth: { healthy: "saine", degraded: "dégradée", unavailable: "indisponible", unknown: "inconnue" },
  },
};

export const settingsExtensionsEs: SettingsExtensionsCatalog = {
  page: {
    bridgeMissing: "La gestión de extensiones no está disponible en este entorno (falta el bridge IPC)", admissionClosed: "Una extensión está convergiendo a desactivada: se revocan proyecciones, se liberan artefactos, se reinician sesiones con snapshots antiguos y se invalidan cachés. No se inician Agents nuevos hasta terminar.", installedTitle: "Extensiones instaladas", installedDescription: "Pega la página del repositorio GitHub sin elegir familia. Un plugin.json en la raíz se convierte en Agent Plugin; si no, debe existir skills/<nombre>/SKILL.md. El producto clasifica el commit fijado y cada componente queda desactivado hasta que lo actives.", installGithub: "Instalar desde GitHub", family: { skillTitle: "Repositorios de Skills", skillDescription: "Solo se materializa el subárbol skills/ de la raíz, sin MCP.", pluginTitle: "Agent Plugins", pluginDescription: "Se empaqueta todo el árbol y puede incluir Skills y servidores MCP. La entrega MCP aún no está disponible y se abrirá por niveles de política separados." }, emptyTitle: "No hay extensiones instaladas", emptyHint: "Tras instalar, aparecen en Repositorios de Skills o Agent Plugins según el formato detectado.", retainedTitle: "Desinstaladas con datos conservados", retainedDescription: "Eliminar el código del paquete nunca borra de forma implícita sus datos. El borrado permanente es una acción separada y reinstalar no recupera datos eliminados.", purgeData: "Eliminar datos permanentemente", retainedCustody: "Custody aún activa: {{custody}}", retainedEpochs: "Quedan {{count}} data epochs en este equipo.",
  },
  install: {
    stage: { source: { title: "Añadir extensión", description: "Pega la página del repositorio sin elegir familia. El sistema fija un commit y trata plugin.json como Agent Plugin o skills/<nombre>/SKILL.md como repositorio de Skills. Activa después cada componente.", commit: "Continuar", pending: "Resolviendo origen…" }, install: { title: "Confirmar instalación", commit: "Confirmar instalación", pending: "Instalando…" }, update: { title: "Confirmar actualización", commit: "Confirmar actualización", pending: "Actualizando…" } }, resolveFailed: "No se pudo resolver el origen", installFailed: "Falló la instalación", summary: "{{url}} @ {{commit}} ({{files}} archivos / {{kilobytes}} KB)", repository: "URL del repositorio", repositoryHint: "Las capacidades se muestran tras resolver un commit inmutable; no se escribe en el registro antes de confirmar. Un repositorio ya instalado se convierte en una generación nueva.", back: "Volver",
    disclosure: { format: "Formato detectado", pluginFormat: "Agent Plugin (plugin.json en la raíz): aparece en Agent Plugins dentro de Settings › Extensions.", skillFormat: "Repositorio de Skills (sin plugin.json, solo skills/): aparece en Repositorios de Skills.", scripts: "Scripts ejecutables", none: "Ninguno", skill: "Skill {{name}}", allowedTools: "allowed-tools: {{tools}}", undeclared: "Sin declarar", mcp: "MCP {{serverId}} ({{transport}})", mcpUnavailable: "La entrega MCP aún no está disponible y se abrirá por niveles separados. {{target}}", staticHeaders: "; headers estáticos: {{headers}}", writeRoot: "Raíz de escritura persistente", writeRootRequired: "Incluye un servidor stdio y necesita una raíz install-owned. Cada generación usa su propio data epoch.", writeRootNone: "No necesaria", capabilityChange: "Cambios de capacidades", addedRemoved: "Añadidas: {{added}} | eliminadas: {{removed}}", noChange: "Sin cambios", report: "Nota del analizador", postUpdate: "Estado tras actualizar", postInstall: "Estado tras instalar", reauthorize: "Las capacidades aumentaron: la generación nueva empieza desactivada y cada componente debe volver a activarse. La generación anterior sigue atendiendo a las Apps vinculadas.", retainAuthorization: "Las capacidades no aumentaron: se mantienen los ajustes actuales y la generación anterior sigue atendiendo a las Apps vinculadas.", defaultDisabled: "Desactivada de forma predeterminada; activa cada componente.", migrateAria: "Migrar {{appId}} a la generación nueva", migrateDescription: "Actualmente vinculada a {{generation}}. Migrar crea una generación pendiente de autorización; sin migrar, la App sigue usando la anterior.", migrateLabel: "Migrar App {{appId}}" },
  },
  package: {
    description: "{{admission}} · {{administration}} · catálogo global {{catalog}} · permisos de App independientes · commit {{commit}}", admission: { valid: "Admitida", misconfigured: "Configuración incorrecta" }, administration: { active: "Administración activa", "disable-pending": "Desactivación administrativa convergiendo", denied: "Administración denegada" }, catalog: { on: "activado", off: "desactivado" }, checkUpdate: "Buscar actualizaciones", disable: "Desactivar", cancelUninstall: "Cancelar desinstalación", uninstall: "Desinstalar", enable: "Activar", mcpUnavailable: "Entrega MCP aún no disponible", eligibilityEntry: "{{backend}}: {{status}}", health: "estado", healthEntry: "{{backend}}={{status}}", turnEffect: "efectivo en este turno: ver en el Chat", componentDescription: "{{kind}} · {{transport}}", kind: { skill: "Skill", "mcp-server": "Servidor MCP" }, generation: "Generación anterior {{generation}}", generationBlocked: "Sigue vinculada exactamente por {{count}} propietarios; se conserva inmutable y direccionable.", generationFree: "Sin referencias; se puede retirar con una desinstalación separada.", done: "Completado", pending: "Pendiente", convergenceBlocked: "Convergencia bloqueada", foreignCopy: "Copia externa {{projectionId}}", foreignCopyDetail: "{{componentIdentity}} no fue escrito por el producto. Solo puede marcarse como {{strength}} y debe resolverse manualmente.", uninstallBlocked: "Desinstalación bloqueada", otherOwners: "Otros propietarios", runtimeReferences: "Referencias runtime", runtimeReferencesDetail: "Quedan {{leases}} leases de proyección; {{artifacts}} artefactos compartidos siguen referenciados y no se eliminarán.", custody: "Custody de proceso / transport", migrate: "Migrar a generación nueva", migrateDescription: "Sigue vinculada exactamente a {{generation}}. La migración vuelve a fijar con la referencia cerrada: required pasa a blocked, optional a degraded y requiere autorización. Si no, cancela la desinstalación.", retryUninstall: "Reintentar desinstalación",
    convergenceStep: { "projection-binding-revoked": "Revocar proyecciones gestionadas", "shared-artifacts-released": "Liberar artefactos por refcount", "product-sessions-drained": "Reiniciar sesiones con snapshots antiguos", "discovery-cache-invalidated": "Invalidar cachés de descubrimiento" }, uninstallStep: { "durable-references-resolved": "Resolver referencias duraderas", "runtime-custody-drained": "Vaciar leases y custody de runtime", "package-generations-removed": "Eliminar todas las generaciones del paquete", "package-bytes-collected": "Recoger bytes sin referencias salvo datos install-owned" }, strength: { "per-tool-enforced": "forzado por herramienta", "per-turn-enforced": "forzado por turno", "server-inclusion-only": "servidor completo", "workspace-requested": "workspace solicitado", "backend-delegated": "delegado al backend", "unsupported-by-policy": "bloqueado por política", unknown: "desconocido" }, exclusion: { "package-disabled": "paquete desactivado", "package-disable-pending": "desactivación de paquete pendiente", "package-generation-removal-pending": "eliminación de generación pendiente", "component-disabled": "componente desactivado", "backend-capability-mismatch": "capacidad del backend incompatible", "delivery-channel-unsupported": "canal de entrega incompatible", "transport-unsupported": "transport incompatible", "projection-unavailable": "proyección no disponible", "runtime-health-failed": "falló el estado del runtime", "turn-policy-ineligible": "turno no elegible", "snapshot-materialization-failed": "falló la materialización del snapshot" }, deliveryHealth: { healthy: "saludable", degraded: "degradado", unavailable: "no disponible", unknown: "desconocido" },
  },
};
