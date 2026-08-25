/**
 * [INPUT]: Depends on shared MemoryHealth/MemoryHealthIssue/MemoryStatusSnapshot/EffectiveTarget/descriptor/rebuild/attention Agreement with MemorySharingMode
 * [OUTPUT]: Provides color tags, hosts memoryBackendState/RuntimeStance, provides a default judgment as recognized by version Source, memoryHealthView, memoryProviderStatusView, memoryMasterRow, memoryServiceNeedsAttention, rebuildOutstanding, includes a recall of the end checklist and the number of failures, and a delivery observation indicator, connects the action to the rebuild location tag
 * [POS]: Settings › Memory is a derivative of the presentation layer; Fold the main's running facts into a directly open label
 */

import type {
  MemoryAttentionAction,
  MemoryAttentionKind,
  MemoryEffectiveTarget,
  MemoryHealth,
  MemoryHealthIssue,
  MemoryProviderDescriptor,
  MemoryRebuildPhase,
  MemoryRebuildSnapshot,
  MemoryRecallSnapshot,
  MemoryRuntimeSnapshot,
  MemoryStatusSnapshot,
} from "../../shared/memory-ipc";
/* ============================================================
 * 色标：呈现层只认五种语气，组件不再各自拼颜色。
 * 语气是派生结论（"挂起 3 条"→danger），不是调用方的自由选择。
 * ============================================================ */

export type MemoryTone = "off" | "neutral" | "ready" | "warn" | "danger";

export type MemoryTranslate = (
  key: string,
  options?: Record<string, unknown>
) => string;

const copy = (
  translate: MemoryTranslate | undefined,
  key: string,
  fallback: string,
  options?: Record<string, unknown>
) => translate?.(key, options) ?? fallback;

export const TONE_TEXT: Record<MemoryTone, string> = {
  off: "text-muted-foreground",
  neutral: "text-foreground",
  ready: "text-emerald-700 dark:text-emerald-400",
  warn: "text-amber-700 dark:text-amber-400",
  danger: "text-destructive",
};

/* 表面色只有三档，文字色才有五档——「一切正常」不需要一张绿卡去
   宣布：静默是正常态的语言，彩色表面全部留给真正要动手的 warn/danger。 */
const QUIET_SURFACE = "bg-card ring-foreground/10";

export const TONE_SURFACE: Record<MemoryTone, string> = {
  off: QUIET_SURFACE,
  neutral: QUIET_SURFACE,
  ready: QUIET_SURFACE,
  /* 与 settings-layout 的 SettingsAlert 同一配方（/10 底 + ring/20）：
     记忆卡与其它设置面的 warn/danger 因此天然一致，无需各写各的 amber。 */
  warn: "bg-amber-500/10 ring-amber-500/20",
  danger: "bg-destructive/10 ring-destructive/20",
};

/* ============================================================
 * 后端卡片的脚注只回答一件事：这个后端此刻在这台机器上是什么处境。
 *
 * 单一路径后只剩托管安装事实：装了就报锁定版本，没装就明确给出入口。
 * ============================================================ */

export type MemoryBackendState = { label: string; tone: MemoryTone };

export function memoryBackendState(
  descriptor: MemoryProviderDescriptor,
  runtime: MemoryRuntimeSnapshot | null,
  translate?: MemoryTranslate
): MemoryBackendState {
  if (runtime && !runtime.installed && runtime.instanceId) {
    return {
      label: copy(translate, "memory.backend.interrupted", "安装中断 · 可修复"),
      tone: "warn",
    };
  }
  if (runtime?.installed) {
    const version = runtime.installedVersion;
    if (!runtime.instanceId) {
      return {
        label: copy(translate, "memory.backend.identityRepair", "安装身份待修复"),
        tone: "warn",
      };
    }
    /* 两阶段的中间态必须在卡片上就可见：EverOS 装完没提交密钥时
       服务根本起不来，「已安装」的绿色结论会和健康卡的「暂不可启用」
       同屏打架——同一事实两处两个说法，读者只会怀疑数据坏了。 */
    if (runtime.phase === "configuration-required") {
      return {
        label: version
          ? copy(translate, "memory.backend.installedNeedsConfigVersion", `已安装 ${version} · 待配置`, { version })
          : copy(translate, "memory.backend.installedNeedsConfig", "已安装 · 待配置"),
        tone: "warn",
      };
    }
    return {
      label: version
        ? copy(translate, "memory.backend.installedVersion", `已安装 ${version}`, { version })
        : copy(translate, "memory.backend.installed", "已安装"),
      /* 失配只对「装的是当时的锁定版、如今应用锁定了新版」成立。用户
         自己在目录里挑的版本不是失配，是意图——把它染黄，等于让产品
         每次开面板都反对一次用户刚做过的决定。判据是 versionSource，
         不是 configModes：后者说的是 ov.conf 由谁写，与版本无关。 */
      tone:
        runtime.versionSource === "locked" && runtime.versionMatch === false
          ? "warn"
          : "ready",
    };
  }
  return {
    label: copy(translate, "memory.backend.notInstalled", "未安装"),
    tone: "off",
  };
}

/* 托管运行时面的叙事姿态只有安装完成与尚未安装两档。 */
export type MemoryRuntimeStance = "managed" | "absent";

export function memoryRuntimeStance(
  runtime: MemoryRuntimeSnapshot | null
): MemoryRuntimeStance {
  if (runtime?.installed) return "managed";
  return "absent";
}

export type MemoryHealthView = {
  tone: MemoryTone;
  label: string;
  detail: string;
};

const UNAVAILABLE_VIEW: Record<
  MemoryHealthIssue["kind"],
  (detail: string) => { label: string; detail: string }
> = {
  unreachable: () => ({
    label: "连不上本机服务",
    detail:
      "服务可能尚未启动。可用下方的「修复安装」重试；连通后这里会自动恢复。",
  }),
  unhealthy: () => ({
    label: "服务未就绪",
    detail: "已连上服务，但它报告尚未就绪，可能仍在启动中；稍后点右上角刷新重试。",
  }),
  auth: (mode) => ({
    label: "服务开启了认证",
    detail: `本产品不读取 CLI 凭据；提取模型密钥只保存在本机。服务连接本身只支持免认证 loopback，请以 dev 模式重启（当前认证模式：${mode}）。`,
  }),
  protocol: () => ({
    label: "地址不是预期的记忆服务",
    detail: "该地址返回了无法识别的内容，请确认端口指向本机记忆服务。",
  }),
  identity: () => ({
    label: "端口被非托管进程占用",
    detail:
      "该端口的监听者不是产品托管的实例（可能托管服务已退出、被其它进程接管）。为避免把对话发给陌生服务，召回与交付已暂停；可在下方修复安装，或退出占用该端口的进程。",
  }),
  configuration: () => ({
    label: "尚未完成配置",
    detail: "运行时已启动但缺少提取所需的密钥；在下方提交配置后即可启用。",
  }),
  version: (version) => ({
    label: "服务不可用",
    detail: `检测到版本 ${version}，握手未通过；点右上角刷新重试。`,
  }),
};

const HEALTH_VIEW: Record<MemoryHealth, MemoryHealthView> = {
  unknown: {
    tone: "neutral",
    label: "尚未检查",
    detail: "点右上角刷新，向本机服务发起一次握手。",
  },
  checking: {
    tone: "neutral",
    label: "检查中",
    detail: "正在连接本机服务并校验握手。",
  },
  ready: {
    tone: "ready",
    label: "服务可用",
    detail: "本机服务连接正常，召回与交付已就绪。",
  },
  compat: {
    tone: "warn",
    label: "兼容模式",
    detail: "服务版本与本产品锁定的版本不同；功能继续可用，如遇异常建议重装锁定版本。",
  },
  unavailable: {
    tone: "danger",
    label: "服务不可用",
    detail: "握手失败；点右上角刷新重试。",
  },
};

export function memoryHealthView(
  enabled: boolean,
  health: MemoryHealth,
  issue: MemoryHealthIssue | null = null,
  translate?: MemoryTranslate
): MemoryHealthView {
  if (!enabled)
    return {
      tone: "off",
      label: copy(translate, "memory.health.offLabel", "已关闭"),
      detail: copy(translate, "memory.health.offDetail", "开启后才会连接本机服务进行召回与交付。"),
    };
  if (health === "unavailable" && issue) {
    const view = UNAVAILABLE_VIEW[issue.kind](issue.detail);
    return {
      tone: issue.kind === "configuration" ? "warn" : "danger",
      label: copy(translate, `memory.health.issue.${issue.kind}.label`, view.label, { detail: issue.detail }),
      detail: copy(
        translate,
        `memory.health.issue.${issue.kind}.detail`,
        `${view.detail}期间记忆暂停，聊天不受影响。`,
        { detail: issue.detail }
      ),
    };
  }
  if (health === "compat" && issue?.kind === "version") {
    return {
      tone: "warn",
      label: copy(translate, "memory.health.compatLabel", "兼容模式"),
      detail: copy(
        translate,
        "memory.health.compatVersionDetail",
        `检测到服务版本 ${issue.detail} 与本产品锁定版本不同。功能继续可用；如遇召回或提取异常，建议重装锁定版本。`,
        { version: issue.detail }
      ),
    };
  }
  const view = HEALTH_VIEW[health];
  return {
    ...view,
    label: copy(translate, `memory.health.${health}Label`, view.label),
    detail: copy(translate, `memory.health.${health}Detail`, view.detail),
  };
}

/* ============================================================
 * 面板首行只回答一个问题：我此刻看着的这个后端，处境如何。
 *
 * 它有两副面孔，因为「当前服务」与「另一个后端」可讲的事实本就
 * 不同：前者有健康握手、有生效地址、能被开关；后者只有库存。
 * 一个组件两套派生，分支写在这里一次，视图不必再判第二遍。
 *
 * detail 可以是 null，而且常常就该是 null。「这个后端是什么」已由
 * 页签上的介绍常驻交代，首行不再兼职复述；「本机服务连接正常，召回
 * 与交付已就绪」这类话只在它不成立时才携带信息。于是判据只剩一条：
 * 有话可说才出现——出事说病因，点不动说为什么，其余保持安静。
 * ============================================================ */

export type MemoryCurrentFacts = {
  enabled: boolean;
  health: MemoryHealth;
  healthIssue: MemoryHealthIssue | null;
  target: MemoryEffectiveTarget | null;
  runningVersion?: string | null;
};

export type MemoryStatusLine = {
  tone: MemoryTone;
  label: string;
  detail: string | null;
};

export function memoryProviderStatusView(
  descriptor: MemoryProviderDescriptor,
  runtime: MemoryRuntimeSnapshot | null,
  /** null = 正在看另一个后端：它没有健康事实，只有库存事实。 */
  current: MemoryCurrentFacts | null,
  translate?: MemoryTranslate
): MemoryStatusLine {
  /* 装好了却连不上：这不是库存问题而是就绪问题。它同时解释右侧那颗
     点不动的按钮——无论那是「设为当前服务」还是开关，句子都不必点名，
     指向下面那两个动作即可。 */
  const stalled = Boolean(runtime?.installed && !runtime.serviceReachable);
  const notReady = () =>
    copy(
      translate,
      "memory.backend.notReady",
      "服务尚未就绪；先在下方修复安装或重新检测。"
    );
  if (!current) {
    const state = memoryBackendState(descriptor, runtime, translate);
    return {
      /* 绿只给正在用的那一档。两档并排时若都发绿，没在用的那个反而更
         抢眼——层级靠减法，该突出的不靠自己变响，靠别人变轻。 */
      tone: stalled ? "warn" : state.tone === "ready" ? "off" : state.tone,
      label: state.label,
      detail: stalled ? notReady() : null,
    };
  }
  /* blockedReason 压过健康结论：fail-closed 的原因比「连不上」更该先说。 */
  const blocked = current.target?.blockedReasonCode
    ? copy(
        translate,
        `memory.health.blocked.${current.target.blockedReasonCode}`,
        current.target.blockedReason ?? "",
        { provider: current.target.providerId }
      )
    : current.target?.blockedReason ?? null;
  if (blocked)
    return {
      tone: "warn",
      label: copy(translate, "memory.health.blockedLabel", "暂不可启用"),
      detail: blocked,
    };
  const view = memoryHealthView(
    current.enabled,
    current.health,
    current.healthIssue,
    translate
  );
  if (view.tone === "ready") return { ...view, detail: null };
  /* 关闭态下开关若还点不动，「开启后会怎样」就不如「为什么现在开不了」。 */
  if (view.tone === "off" && stalled) return { ...view, detail: notReady() };
  return view;
}

/* ============================================================
 * 主控行：整页唯一的产品级开关，以及它此刻的处境。
 *
 * 这颗开关从前寄居在 provider 面板的第一行，于是同一个槽位在切页签
 * 时会变形成「设为当前服务」——一个位置，两个层级的语义。开关归产品，
 * 页签归服务；把它拔出来之后，面板的 control 槽只剩一种含义。
 *
 * 摘要与面板结论必须同源：这里不自己判健康，而是复用 memoryHealthView。
 * 两处各判一次，迟早各说各话。已启用但服务不就绪时，摘要必须落到故障
 * 结论而不是「已开启」——顶部那句话是全页第一眼，它一撒谎，下面所有
 * 细节都白写。
 *
 * label 刻意不复述段标题：h2 说这是什么，这一行说它此刻怎么样。
 * ============================================================ */

export type MemoryMasterRow = {
  tone: MemoryTone;
  label: string;
  /** null = 没话可说。安静本身就是「一切正常」的语言。 */
  detail: string | null;
  switchChecked: boolean;
  /** 只表达语义上的点不动；loading 这类瞬时忙由调用方自己 or 进来。 */
  switchDisabled: boolean;
  switchLabel: string;
};

export function memoryMasterRow(
  memory: { enabled: boolean; paused: boolean },
  status: MemoryStatusSnapshot,
  gateOpen: boolean,
  translate?: MemoryTranslate
): MemoryMasterRow {
  const switchLabel = memory.paused
    ? copy(translate, "memory.page.resume", "恢复长期记忆")
    : memory.enabled
      ? copy(translate, "memory.page.pause", "暂停长期记忆")
      : copy(translate, "memory.page.enable", "启用长期记忆");

  /* 暂停压过健康：服务跑得再好，此刻也确实什么都不记。 */
  if (memory.enabled && memory.paused)
    return {
      tone: "warn",
      label: copy(translate, "memory.page.statePaused", "已暂停"),
      detail: copy(
        translate,
        "memory.page.pausedBanner",
        "长期记忆已暂停；聊天、工具、App 与 Skill 一切照常。"
      ),
      switchChecked: false,
      switchDisabled: false,
      switchLabel,
    };

  if (memory.enabled) {
    const view = memoryHealthView(
      true,
      status.health,
      status.healthIssue,
      translate
    );
    /* 判据是「此刻还记不记」，不是「语气红不红」：compat 仍在记，
       checking 只是还没问完。从前这里按 tone !== "ready" 一刀切，
       于是兼容模式与检查中都被报成故障——两种都不是。 */
    if (status.health === "unavailable")
      return {
        tone: view.tone,
        label: copy(
          translate,
          "memory.page.stateUnavailable",
          "已暂停 · 服务不可用"
        ),
        /* 只说后果。病因、地址与修复动作归下面那一档服务自己讲——
           同一句诊断隔着 60px 说两遍，第二遍不会让人更确信。而
           memoryServiceNeedsAttention 保证它此刻一定是摊开的。 */
        detail: copy(
          translate,
          "memory.page.pausedBanner",
          "长期记忆已暂停；聊天、工具、App 与 Skill 一切照常。"
        ),
        switchChecked: true,
        switchDisabled: false,
        switchLabel,
      };
    return {
      tone: view.tone,
      /* 只说记不记。用哪个后端是它的子项自己的事——父说 whether，
         子说 which，同一个名词不在一张卡里出现两次。 */
      label: copy(translate, "memory.page.stateOn", "已开启"),
      /* 一切正常时没话可说；compat 与 checking 各自把自己解释掉。 */
      detail: view.tone === "ready" ? null : view.detail,
      switchChecked: true,
      switchDisabled: false,
      switchLabel,
    };
  }

  /* 关闭态下，「为什么现在开不了」比「开起来会怎样」更该先说。 */
  const blocked = status.target?.blockedReasonCode
    ? copy(
        translate,
        `memory.health.blocked.${status.target.blockedReasonCode}`,
        status.target.blockedReason ?? "",
        { provider: status.target.providerId }
      )
    : (status.target?.blockedReason ?? null);
  const stuck = status.target?.canEnable === false || !gateOpen;
  return {
    tone: "off",
    label: copy(translate, "memory.health.offLabel", "已关闭"),
    detail: stuck
      ? blocked ||
        copy(
          translate,
          "memory.backend.notReady",
          "服务尚未就绪；先在下方修复安装或重新检测。"
        )
      : copy(
          translate,
          "memory.health.offDetail",
          "开启后才会连接本机服务进行召回与交付。"
        ),
    switchChecked: false,
    switchDisabled: stuck,
    switchLabel,
  };
}

/* ============================================================
 * 服务档要不要自己摊开：没装、待配置、连不上，或开着却不可用。
 *
 * 它与主开关的 `stuck` 共用同一个 `gateOpen`，于是「点不动」与「摊开」
 * 不可能各说各话；`unavailable` 那一档则保证主控行只说后果时，病因、
 * 地址与修复动作一定在同屏可见——折叠永远藏不住一件坏掉的东西。
 * ============================================================ */

export const memoryServiceNeedsAttention = (
  memory: { enabled: boolean },
  status: MemoryStatusSnapshot,
  gateOpen: boolean
) => !gateOpen || (memory.enabled && status.health === "unavailable");

/* ============================================================
 * 重建是否还占着这台机器：在跑与中断都算，只有 completed 是往事。
 *
 * 这一判据从前散在三处，各自写错的方式还不一样：入口按钮把「有过
 * 一次重建」当成「正在重建」，于是第二次重建永远点不动；进度卡把
 * 完成态一直挂在观测区，读起来既不像通知也不像状态。判据收成一个
 * 谓词，三处便只能同进同退。
 * ============================================================ */

export const rebuildOutstanding = (rebuild: MemoryRebuildSnapshot | null) =>
  Boolean(rebuild && rebuild.phase !== "completed");

/* ============================================================
 * 时间：绝对时间戳适合审计，不适合扫描。相对时间进正文，
 * 绝对时间退到 title——两者都在，注意力只花在一处。
 * ============================================================ */

export function relativeMoment(
  at: number | null,
  now: number,
  locale = "zh-CN",
  translate?: MemoryTranslate
): string {
  if (!at) return copy(translate, "memory.time.none", "尚无");
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return copy(translate, "memory.time.now", "刚刚");
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "always" });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return formatter.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return formatter.format(-hours, "hour");
  return formatter.format(-Math.floor(hours / 24), "day");
}

export function absoluteMoment(
  at: number | null,
  locale?: string
): string | undefined {
  return at ? new Date(at).toLocaleString(locale) : undefined;
}

/* ============================================================
 * 观测指标：数值是主角，标签是配角。event 是「上次发生了什么」，
 * counter 是「现在积压多少」——两者粒度不同，分区之后各得其所。
 * ============================================================ */

export type MemoryStat = {
  key: string;
  group: "event" | "counter";
  value: string;
  label: string;
  tone: MemoryTone;
  at: number | null;
};

/* ============================================================
 * 召回事件格：结局有四档（含「还没召回过」），每档各有文案键、
 * 兜底句与语气。从前写成三层嵌套三元，且语气与文案是两处各判
 * 一遍的——改一处忘另一处，格子就会一边说「零命中」一边发绿。
 * 一张表把三件事钉死在同一行上，分支便无处走岔。
 * ============================================================ */

type MemoryRecallOutcome =
  | NonNullable<MemoryRecallSnapshot["lastOutcome"]>
  | "idle";

const RECALL_EVENT: Record<
  MemoryRecallOutcome,
  {
    key: string;
    fallback: (recall: MemoryRecallSnapshot) => string;
    tone: MemoryTone;
  }
> = {
  used: {
    key: "memory.activity.recallUsed",
    fallback: (recall) => `最近召回 · 命中 ${recall.lastCount ?? 0} 条`,
    tone: "ready",
  },
  none: {
    key: "memory.activity.recallNone",
    fallback: () => "最近召回 · 零命中",
    tone: "neutral",
  },
  unavailable: {
    key: "memory.activity.recallFailed",
    fallback: () => "最近召回 · 暂不可用",
    tone: "warn",
  },
  idle: {
    key: "memory.activity.lastRecall",
    fallback: () => "最近召回",
    tone: "off",
  },
};

export function memoryActivityStats(
  status: MemoryStatusSnapshot,
  now: number,
  locale = "zh-CN",
  translate?: MemoryTranslate
): MemoryStat[] {
  const { pendingTurns, inflightBatches, deliveredTurns, gapTurns } =
    status.delivery;
  /* recall 是必填契约，不再就地发明一份默认值：呈现层一旦自带兜底，
     「main 还没测到」与「测到全是零」就会在这里被抹成同一个事实。 */
  const recall = status.recall;
  /* 重建完成后不再占着一张常驻卡，而是退成一条带时刻的往事，与「最近
     交付」并排：同一区里两条都在回答「上一次发生在什么时候」。没重建过
     的人不该看见一格永远写着「尚无」的空指标，故它按需出现。 */
  const settled =
    status.rebuild && !rebuildOutstanding(status.rebuild) ? status.rebuild : null;
  const recallEvent = RECALL_EVENT[recall.lastOutcome ?? "idle"];
  const failedSuffix =
    recall.failedTurns > 0
      ? ` · ${copy(
          translate,
          "memory.activity.recallFailedCount",
          `故障 ${recall.failedTurns}`,
          { count: recall.failedTurns }
        )}`
      : "";
  const rebuilt: MemoryStat[] = settled
    ? [
        {
          key: "rebuild",
          group: "event",
          value: relativeMoment(settled.startedAt, now, locale, translate),
          label: copy(translate, "memory.activity.rebuilt", "上次重建 · 已完成"),
          tone: "neutral",
          at: settled.startedAt,
        },
      ]
    : [];
  return [
    {
      key: "capture",
      group: "event",
      value: relativeMoment(status.lastCaptureAt, now, locale, translate),
      label: copy(translate, "memory.activity.lastCapture", "最近交付 · canonical 落盘后"),
      tone: status.lastCaptureAt ? "neutral" : "off",
      at: status.lastCaptureAt,
    },
    {
      key: "recall",
      group: "event",
      value: relativeMoment(recall.lastAt, now, locale, translate),
      /* 「零召回与召回故障分开记录」是这一页亲口给出的承诺。故障累计
         非零却只字不提，那句话就只是文案：把它接在结局之后一起说，
         承诺才在同一格里兑现——分开记录的前提是分开看得见。 */
      label:
        copy(translate, recallEvent.key, recallEvent.fallback(recall), {
          count: recall.lastCount ?? 0,
        }) + failedSuffix,
      tone: recallEvent.tone,
      at: recall.lastAt,
    },
    ...rebuilt,
    {
      key: "delivered",
      group: "counter",
      value: `${deliveredTurns}`,
      label: copy(translate, "memory.activity.delivered", "已交付 turn"),
      tone: deliveredTurns > 0 ? "neutral" : "off",
      at: null,
    },
    {
      key: "pending",
      group: "counter",
      value: `${pendingTurns}`,
      label: copy(translate, "memory.activity.pending", "待交付"),
      tone: pendingTurns > 0 ? "neutral" : "off",
      at: null,
    },
    {
      key: "inflight",
      group: "counter",
      value: `${inflightBatches}`,
      label: copy(translate, "memory.activity.inflight", "在途批"),
      tone: inflightBatches > 0 ? "neutral" : "off",
      at: null,
    },
    /* gap 必须永远出现：把「授权过但已经发不出去」的事实藏起来，
       就是在 0/0/0 的表象下宣称记忆是完整的。 */
    {
      key: "gap",
      group: "counter",
      value: `${gapTurns}`,
      label: copy(translate, "memory.activity.gap", "缺口 turn · 已授权未送达"),
      tone: gapTurns > 0 ? "warn" : "off",
      at: null,
    },
    /* key 是给 testid 与调试用的稳定标识，不是标签的拼音缩写：
       recallused 读起来像一个词，recall-used 才看得出它由两段构成。 */
    {
      key: "recall-used",
      group: "counter",
      value: `${recall.usedTurns}`,
      label: copy(translate, "memory.activity.recallUsedTurns", "召回命中 turn"),
      tone: recall.usedTurns > 0 ? "ready" : "off",
      at: null,
    },
    {
      key: "recall-zero",
      group: "counter",
      value: `${recall.zeroTurns}`,
      label: copy(translate, "memory.activity.recallZeroTurns", "零命中 turn"),
      tone: recall.zeroTurns > 0 ? "neutral" : "off",
      at: null,
    },
    /* 这里曾有第五格「待处置挂起」，值就是 attention.length。它把
       下方「需要处置」逐条铺开的同一批事项又数了一遍，读者得自己
       确认两处说的是不是一回事；四列网格里它还永远孤零零掉到第二行。
       一个数字若在别处已被完整讲述，它就不是指标，只是回声。 */
  ];
}

export const ATTENTION_LABEL: Record<MemoryAttentionKind, string> = {
  "capture-gap": "提取交付存在缺口",
  "cleanup-failed": "远端清理失败",
  "rebuild-failed": "重建中断",
  "capacity-pressure": "记忆账本需要压缩",
};

export const ATTENTION_ACTION_LABEL: Record<MemoryAttentionAction, string> = {
  acknowledge: "已知悉",
  "retry-cleanup": "重试清理",
  compact: "立即压缩",
  abandon: "放弃并记账",
  "resume-rebuild": "继续重建",
};

export const REBUILD_PHASE_LABEL: Record<MemoryRebuildPhase, string> = {
  prepared: "准备中",
  quiescing: "静默进行中的请求",
  reconciling: "对账在途提交",
  purging: "清理远端",
  "watermarks-cleared": "重置水位",
  backfilling: "回灌历史",
  completed: "已完成",
  failed: "已中断",
};

export function attentionLabel(
  kind: MemoryAttentionKind,
  translate?: MemoryTranslate
) {
  return copy(
    translate,
    `memory.attention.kind.${kind}`,
    ATTENTION_LABEL[kind]
  );
}

export function attentionActionLabel(
  action: MemoryAttentionAction,
  translate?: MemoryTranslate
) {
  return copy(
    translate,
    `memory.attention.action.${action}`,
    ATTENTION_ACTION_LABEL[action]
  );
}

export function rebuildPhaseLabel(
  phase: MemoryRebuildPhase,
  translate?: MemoryTranslate
) {
  return copy(
    translate,
    `memory.rebuild.phase.${phase}`,
    REBUILD_PHASE_LABEL[phase]
  );
}
