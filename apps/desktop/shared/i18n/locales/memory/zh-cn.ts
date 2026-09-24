/**
 * [INPUT]: Depends on memoryEn from ./en for both its structural type and the English leaves this catalog reuses
 * [OUTPUT]: Provides memoryZhCN, the Simplified Chinese Memory catalog
 * [POS]: Simplified Chinese leaf of shared/i18n/locales/memory; loaded on demand by the matching top-level locale
 */

import { memoryEn } from "./en";

export const memoryZhCN: typeof memoryEn = {
  ...memoryEn,
  store: {
    providerListFailed: "Memory provider 列表读取失败",
    statusFailed: "Memory 状态读取失败",
    healthFailed: "Memory 健康检查失败",
    historyPreviewFailed: "Memory 历史预览失败",
    attentionFailed: "Memory 挂起处置失败",
    runtimeStatusFailed: "Memory 运行时状态读取失败",
    configIssueFailed: "Memory 配置问题处置失败",
    manualConfigPreviewFailed: "Memory 手工配置目的地预览失败",
    runtimeOperationFailed: "Memory 运行时操作失败",
    updateCheckFailed: "Memory 版本检查失败",
    configPreviewFailed: "Memory 配置目的地预览失败",
    configAuthorityFailed: "Memory 配置目的地授权失败",
    manualConfigAuthorityFailed: "Memory 手工配置目的地授权失败",
    configSubmitFailed: "Memory 运行时配置提交失败",
    destructiveAuthorityFailed: "Memory 破坏性操作授权失败",
    destructiveFailed: "Memory 破坏性操作失败",
  },
  common: { unread: "尚未读取", paused: "暂停", enabled: "开启" },
  time: { none: "尚无", now: "刚刚" },
  provider: {
    openviking: {
      summary: "清理精确到 workspace——删掉一个范围，其余的留着。",
      panel: { title: "OpenViking 提取模型", description: "密钥、Base URL 与模型名只保存在本机 secrets 与 0600 受管 ov.conf；手工接管后需直接编辑文件。" },
      field: {
        OPENVIKING_LLM_API_KEY: { label: "提取模型 API Key", description: "必填；用于从对话中提取长期记忆。" },
        OPENVIKING_LLM_BASE_URL: { label: "Base URL", description: "OpenAI 兼容接口地址，例如 https://api.deepseek.com/v1。" },
        OPENVIKING_LLM_MODEL: { label: "Model", description: "提取模型名，例如 deepseek-chat。" },
      },
    },
    everos: {
      summary: "清理会重置整个 runtime——所有范围一次性清空。",
      panel: { title: "EverOS 提取密钥", description: "EverOS 需要模型服务密钥才能启动。凭据只留在本机 secrets 与 LaunchAgent，不读取 CLI 凭据。" },
      field: {
        EVEROS_LLM__API_KEY: { label: "提取模型 API Key", description: "用于长期记忆提取的 OpenAI 兼容模型服务密钥。" },
        EVEROS_LLM__BASE_URL: { label: "Base URL", description: "OpenAI 兼容接口地址，例如 https://api.deepseek.com/v1。" },
        EVEROS_LLM__MODEL: { label: "Model", description: "提取模型名，例如 deepseek-chat。" },
      },
    },
  },
  backend: { homepage: "项目主页", notReady: "服务尚未就绪；先在下方修复安装或重新检测。", installed: "已安装", installedNeedsConfig: "已安装 · 待配置", installedNeedsConfigVersion: "已安装 {{version}} · 待配置", notInstalled: "未安装", dataLocation: "在访达中显示数据位置", dataLocationFailed: "数据位置尚不可用，请先修复或重新安装。", interrupted: "安装曾中断", identityRepair: "修复安装身份" },
  health: {
    offLabel: "已关闭", offDetail: "开启后才会连接本机服务进行召回与交付。", unknownLabel: "尚未检查", unknownDetail: "点右上角刷新，向本机服务发起一次握手。", checkingLabel: "检查中", checkingDetail: "正在连接本机服务并校验握手。", readyLabel: "服务可用", readyDetail: "本机服务连接正常，召回与交付已就绪。", compatLabel: "兼容模式", compatDetail: "服务版本与本产品锁定版本不同；功能继续可用。", compatVersionDetail: "检测到服务版本 {{version}} 与锁定版本不同。功能继续可用；如遇异常建议重装锁定版本。", unavailableLabel: "服务不可用", unavailableDetail: "握手失败；点右上角刷新重试。", blockedLabel: "暂不可启用",
    blocked: { ownership: "托管数据目录归属校验失败；为避免写入陌生数据根，记忆已停用。可在下方修复安装以恢复。", configuration: "尚未完成配置；提交提取密钥后才能启用。", "not-installed": "托管记忆服务尚未安装；在下方完成安装，就绪后即可开启记忆。" },
    issue: {
      unreachable: { label: "连不上本机服务", detail: "服务可能尚未启动，可用下方的“修复安装”重试。期间记忆暂停，聊天不受影响。" },
      unhealthy: { label: "服务未就绪", detail: "已连上服务，但它可能仍在启动；稍后刷新重试。期间记忆暂停，聊天不受影响。" },
      auth: { label: "服务开启了认证", detail: "产品不读取 CLI 凭据；请以 dev 模式重启 loopback 服务。当前认证模式：{{detail}}。期间记忆暂停，聊天不受影响。" },
      protocol: { label: "地址不是预期的记忆服务", detail: "该地址返回了无法识别的协议。期间记忆暂停，聊天不受影响。" },
      identity: { label: "端口被非托管进程占用", detail: "为避免把对话发给陌生进程，交付已停止。请修复安装或释放端口；聊天不受影响。" },
      configuration: { label: "尚未完成配置", detail: "在下方提交提取密钥即可启用。期间记忆暂停，聊天不受影响。" },
      version: { label: "服务不可用", detail: "检测到服务版本 {{detail}} 握手失败。期间记忆暂停，聊天不受影响。" },
    },
  },
  activity: { aria: "Memory 运行观测", empty: "还没有召回或交付记录——每次召回与每批交付都会记在这里。", lastCapture: "最近交付 · canonical 落盘后", lastRecall: "最近召回", recallUsed: "已发送记忆", recallNone: "无相关记忆", recallFailed: "召回不可用", recallFailedCount: "故障 {{count}}", recallUsedTurns: "发送过记忆的轮次", recallZeroTurns: "零匹配轮次", rebuilt: "上次重建 · 已完成", delivered: "当前范围累计交付 turn", pending: "当前范围待交付", inflight: "在途批", gap: "缺口 turn · 已授权未送达" },
  attention: { kind: { "capture-gap": "提取交付存在缺口", "cleanup-failed": "远端清理失败", "rebuild-failed": "重建中断", "capacity-pressure": "记忆账本需要压缩" }, action: { acknowledge: "已知悉", "retry-cleanup": "重试清理", compact: "立即压缩", abandon: "放弃并记账", "resume-rebuild": "继续重建" } },
  engines: {
    title: "记忆引擎", aria: "记忆引擎",
    description: "选择持有记忆的引擎，并在这里管理它。同一时刻只有一个在用——换过去要先清理或重建；装上另一个不花代价。",
    manage: "管理 {{provider}}", collapse: "收起 {{provider}}",
    versionRow: "版本", modelRow: "提取模型", runtimeRow: "运行时",
    inUse: "正在使用", updateAvailable: "有可用更新",
    modelConfigured: "密钥与模型只保存在本机。", modelUnset: "尚未配置——提交提取密钥后服务才会启动。",
    runtimeManaged: "托管安装 · {{url}}", runtimeAutostart: "登录自启 · 崩溃后自动重启。",
    installAction: "安装 {{provider}}",
  },
  setup: {
    recommended: "推荐", chooseTitle: "选择记忆引擎", chooseDescription: "它会装进这台 Mac 上独立且锁定版本的 Python 环境。之后可以随时更换引擎。",
    installingTitle: "正在安装 {{provider}}", installedTitle: "{{provider}} 已安装", installFailedTitle: "{{provider}} 未能装完",
    installingDescription: "只需安装一次。之后服务会在登录时启动，崩溃后自动重启。", background: "转到后台继续", backgroundNote: "安装会在后台继续——在「设置 › 记忆」里可以看到进度，装完后在那里连接模型。",
    connectTitle: "连接模型", connectDescription: "由一个 OpenAI 兼容模型读取你写的消息，提取值得记住的内容。密钥只保存在这台 Mac 上。", connectSubmit: "启动服务",
    draftKept: "关闭后草稿会保留，直到成功生效。",
    row: {
      notSetUp: "未设置",
      installing: "安装中",
      installed: "已安装",
      failed: "安装失败",
      description: "记住过往对话里重要的内容，并在相关时带回来。会在这台 Mac 上运行一个小型服务。",
      installingDescription: "正在安装 {{provider}}——会在后台继续，稍后可以再完成设置。",
      connectDescription: "{{provider}} {{version}} 已安装。连接一个模型即可开始记忆。",
      failedDescription: "{{provider}} 未能装完。重新设置即可重试。",
      setUp: "设置…",
      showProgress: "查看进度",
      connect: "连接…",
    },
    notes: {
      title: "开始之前",
      localTerm: "只留在这台 Mac 上",
      localDetail: "记忆库存永远不会离开这台电脑。运行时与数据目录相互独立。",
      modelTerm: "需要一个模型来提取记忆",
      modelDetail: "只有你写的消息会发送给你连接的 OpenAI 兼容模型，别的都不会。",
      removeTerm: "随时可以移除",
      removeDetail: "关闭记忆会暂停召回；移除则会删除服务及其数据。无论哪种情况，Chat 都照常工作。",
    },
  },
  page: { ...memoryEn.page, providerMissing: "配置的记忆服务“{{provider}}”未注册。", refreshHealth: "刷新 Memory 健康状态", title: "长期记忆", description: "只处理人工 turn，记忆库存留在本机。关掉之后不再召回、也不再记录——Chat、Tools、Apps 与 Skills 照常工作。", stateOn: "已开启", stateUnavailable: "已暂停 · 服务不可用", statePaused: "已暂停",  applyFailedTitle: "配置已保存，但尚未在运行时生效", applyFailedFallback: "应用失败", applyRetrying: "正在后台自动重试，生效后本条自动消失。", resume: "恢复长期记忆", pause: "暂停长期记忆", enable: "启用长期记忆", observability: "运行观测", observabilityDescription: "零召回与召回故障分开记录；交付批本地 durable，聊天主链始终 fail-open。", observabilityEpoch: "记忆自 {{date}} 起 · 第 {{generation}} 代范围", recallWarningTitle: "召回指标暂不可用", pausedBanner: "长期记忆已暂停。当前 Chat、Tools、Apps 与 Skills 仍照常工作。", attentionTitle: "需要处置", attentionDescription: "每一项都有明确的恢复动作；系统不会替你猜远端到底发生了什么。", resumeFailed: "Memory 恢复失败", pauseFailed: "Memory 暂停失败", consentFailed: "Memory 确认应用失败", configTitle: "确认更改 Memory 提取目的地？", configChange: "提取目的地将从 {{currentHostname}}/{{currentModel}} 改为 {{nextHostname}}/{{nextModel}}。", configDisclosure: "之后授权的新消息会发送到这个目的地；第三方服务可能产生费用。现有历史不会自动扩大授权范围。", configConfirm: "确认并应用", pauseTitle: "暂停长期记忆？", pauseDescription: "确认后停止新的召回与交付；Chat、Tools、Apps 与 Skills 不受影响。已经发送或进入发送阶段的请求无法撤回。", pauseConfirm: "暂停记忆" },
  disclosure: { ...memoryEn.disclosure, enableTitle: "启用长期记忆？", switchTitle: "切换长期记忆服务？", processing: "发送范围仅限人工对话的用户正文与成功回复。Tools、Apps、Skills 与产品上下文不发送，Agent 处理消息的方式不变。", destination: "提取目的地", readingDestination: "正在读取目的地…", thirdParty: "记忆库存本机。第三方可能记录请求、消耗额度或产生费用。", includeHistory: "从现在开始并导入选定历史", scopeHistory: "{{chats}} 个 Chat、{{turns}} 轮已选历史", scopeNew: "仅确认成功后产生的新人工对话", scopePrefix: "本次范围：{{scope}}", historyRange: "{{from}} – {{to}}", gaps: "有 {{count}} 个 Chat 存在已裁剪、无法恢复的缺口。", pauseBoundary: "可随时暂停，但已进入发送阶段的请求无法撤回，发送成功也不代表模型一定采用。", atLeastOnce: "发送为 at-least-once：服务无幂等键时，崩溃恢复可能重复提取同一轮。", switchBack: "切回原服务前须先清理或重建，旧数据不会被静默复用。", confirmSwitch: "确认并切换", confirmEnable: "确认并启用" },
  sharing: {
    title: "共享范围", description: "决定新记忆能在哪些 Chat 中召回；切换范围绝不会自动复用旧范围数据。", disabledMemory: "请先启用长期记忆，再修改共享范围。", disabledTarget: "当前记忆目标不可用。", previewFailed: "Memory 共享范围预览失败",
    dialogTitle: "更改记忆共享范围？", oldScopeRetained: "旧范围数据会保留，但立即停止召回；系统不会自动合并它们。", historyPaused: "暂停期间可改范围，但要导入历史，请先恢复长期记忆。", confirm: "确认更改范围", readingScope: "正在读取目标范围…",
    mode: { chat: "仅当前 Chat", group: "Project / 独立 Chat 池", personal: "个人记忆池" },
    isolation: { chat: "新记忆仅供当前 Chat incarnation 召回。", group: "同一 Project 的 Chat 可互相召回；所有独立 Chat 共用一个单独池。", personal: "所有 Project 与独立 Chat 都可从同一个个人记忆池召回。" },
  },
  supply: { title: "记忆供给明细", summary: "{{streams}} 个来源 · 已交付 {{delivered}}", disabled: "启用记忆并完成 owner 初始化后才能查看。", loadFailed: "记忆来源读取失败；收起后重新展开即可重试。", foreign: "外部导入的历史", untitled: "未命名 Chat", archived: "已归档", deleted: "已删除", counts: "已交付 {{delivered}} · 待交付 {{pending}} · 缺口 {{gap}}", empty: "当前范围还没有对话供给。" },
  version: { historyTitle: "最近安装", loading: "正在读取版本目录…", confirmTitle: "把 {{provider}} 切换到 {{version}}？", listStale: "读取过程中运行时发生了变化，这份版本列表已过期；请再试一次。", description: "精确安装所选 release；只有健康检查成功后才写入 last-known-good。", current: "当前", locked: "推荐", latest: "最新", yanked: "已撤回", selected: "自选版本", currentYanked: "当前版本已被 PyPI 撤回；可以保留，也可以主动切换。", downgradeWarning: "这是降级操作。现有数据保留，但运行时兼容性可能变化。", unverifiedWarning: "该版本未经产品验证；模型沿用锁定版规格与既有文件。仅当上游改用新模型文件名时，首启才会由 OpenViking 无进度自行下载。", catalogStaleWarning: "版本元数据刷新失败，当前缓存可能过期。", catalogValidationWarning: "PyPI 公告版本与可安装目录不一致，已按可安装目录计算。", listFailed: "版本列表读取失败，请重试。", switchFailed: "版本切换失败，请查看运行时错误后重试。", runningInBackground: "切换会在后台继续；可以关闭弹窗，并在 Memory 页面查看真实进度。", confirm: "切换版本", action: "选择版本", available: "可更新到 {{version}}", check: "检查更新" },
  rebuild: { ...memoryEn.rebuild, button: "重建记忆", title: "重建记忆？", confirm: "开始重建", unavailable: "重建期间长期记忆暂不可用，当前 Chat 仍照常工作。", progress: "已清理 {{purged}}/{{totalScopes}} 个远端会话 · 已回灌 {{backfilledTurns}}/{{totalTurns}} 个 turn", intentStable: "完成或失败都不会改变你的开启或暂停设置。", description: "这会先清空 {{provider}} 当前 data instance 上由本产品写入的全部记忆，再重新提取仍存续且已获授权的内容；不是只重跑当前 Chat。", scope: "预计范围：{{chats}} 个 Chat、{{turns}} 个 turn；目的地为 {{hostname}}/{{model}}。这可能耗时、消耗额度或产生费用。", pauseIntent: "重建期间长期记忆暂不可用，Chat 不受影响。完成保留“{{intent}}”设置；过程中修改则以最新设置为准。", trimmed: "已被裁剪的历史无法恢复，会如实记入缺口账本。", resetManualConfig: "若配置文件已手工接管，运行时重置会清除该文件并恢复产品管理。", phase: { prepared: "准备中", quiescing: "静默进行中的请求", reconciling: "对账在途提交", purging: "清理远端", "watermarks-cleared": "重置水位", backfilling: "回灌历史", completed: "已完成", failed: "已中断" } },
  receipt: { ...memoryEn.receipt, used: "长期记忆 · 已随请求发送 {{count}} 条", usedDetail: "发送不代表模型一定采用", none: "长期记忆 · 未找到相关内容", unavailable: "长期记忆不可用 · 本轮未使用长期记忆", planMode: "长期记忆 · 本轮未使用（Plan 模式）", promptNotIssued: "长期记忆 · Agent 请求未成功发送", failure: { initialization: "记忆状态初始化失败", "scope-resolution": "无法解析本轮记忆范围", "policy-store": "记忆授权账本不可用", "runtime-configuration": "记忆运行时配置不可用", identity: "记忆服务身份校验失败", provider: "记忆服务调用失败", ownership: "记忆归属校验失败", deadline: "记忆召回超过时限", "render-budget": "记忆上下文超过渲染预算", "stale-capability": "记忆能力已失效" } },
  runtime: {
    installHeading: "安装本地记忆服务", installPackage: "安装 {{provider}} {{version}}（独立 Python 环境、版本锁定；来源与校验过程在日志中可见）。", installAutostart: "注册登录自启：服务常驻本机 {{url}}，崩溃自动拉起。", installStorage: "记忆库存本机；提取内容可能发送到你配置的模型服务。运行时与数据目录分离。", installAction: "一键安装", managedNeedsConfig: "{{provider}} {{version}} 已安装，等待提取密钥；提交后注册登录自启并启动服务。", repairAction: "修复安装", repairTitle: "修复 {{provider}} 安装？", repairDescription: "这会短暂停止服务并重新安装当前托管运行时。记忆数据、提取模型配置与安装身份都会保留，完成后服务自动重启。", running: "执行中…", openRunning: "打开 Memory 运行状态", retryInstall: "重试安装", unsupported: "当前平台暂不支持一键安装。", versionMismatch: "已安装 {{installed}}，本版应用锁定 {{locked}}。功能继续可用；建议升级。", stepFailed: "{{step}}失败：", configModified: "{{file}} 已被手工修改", configModifiedDetail: "覆盖重生成会恢复产品管理；手工接管后需直接修改文件中的 key 与模型。", regenerate: "覆盖重生成", adoptManual: "手工接管", manualDetail: "配置已手工接管；产品不会改写该文件。", steps: "步骤 {{current}}/{{total}}", preparing: "准备中", upgradeTo: "升级到 {{version}}", recheck: "重新检测", downloadHint: "需要下载依赖，可能持续数分钟", errorLog: "错误日志", hideLog: "收起日志", showLog: "查看日志", configureAction: "配置提取模型", configDialogTitle: "配置 {{provider}}", retainBlank: "留空表示保留已有值", draftRetained: "关闭弹窗或重启失败都会在内存中保留本次填写；仅配置成功后清空。", submitRestart: "提交并重启服务", savingConfig: "正在保存…", configSaveFailed: "提取模型配置保存失败", uninstallTitle: "卸载 {{provider}} 托管运行时？", uninstallDescription: "这会停止服务、移除登录自启，并永久删除托管运行时目录及其中全部长期记忆数据。若正在使用该后端，长期记忆将自动关闭。", uninstallRetention: "授权账本与聊天记录不受影响；重新安装后可通过重建重新提取保留窗口内的已授权历史。", uninstallConfirm: "卸载并删除数据", modelTransferAria: "模型下载进度", modelTransfer: "{{received}} / {{total}} MiB", modelRecovered: "模型校验失败，正在重新下载可信副本。", interruptedInstall: "安装在归属提交前中断；重试会安全替换残留运行时。", versionIntentRecoveryRequired: "切换到 {{version}} 时在候选版本验真前中断；修复会恢复 last-known-good 运行时。", versionCandidateAwaitingReadiness: "{{version}} 已安装但尚未通过就绪验真；提交所需配置后会校验并晋升。", identityRepair: "托管文件存在但安装清单丢失；修复会从 ownership marker 重建身份。", identityMissing: "目录没有产品归属标记，不会被自动接管。",
    step: {
      "refresh-version-catalog": "刷新可信版本目录", "remove-plist": "移除登录自启", "remove-venv": "移除候选运行环境", "prepare-toolchain": "准备锁版 uv 工具链", "ensure-venv": "创建 Python {{version}} 环境", "fetch-artifacts": "下载并校验安装包",
      "install-packages": "安装锁定版本 {{version}}（可能需数分钟）", "install-packages_selected": "安装自选版本 {{version}}（可能需数分钟）",
      "register-manifest": "登记托管安装", initialize: "初始化数据根", "model-assets": "下载 embedding 模型", "config-converge": "收敛托管配置", "install-plist": "写入登录自启",
      bootstrap: "启动服务", bootstrap_deferred: "启动待配置完成", "await-ready": "等待服务就绪", "await-ready_deferred": "就绪检查待配置完成",
      "config-write": "写入运行时配置", "config-regenerate": "重生成运行时配置", "config-adopt-manual": "接管手工配置", bootout: "停止服务", "wipe-data": "清理运行时数据", "remove-root": "删除运行时与数据",
    },
  },
};
