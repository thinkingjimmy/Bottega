/**
 * [INPUT]: Depends on shared Memory health/runtime/status contracts, MemorySettings sharing modes, and a host-supplied catalog translator
 * [OUTPUT]: Provides catalog-only Memory presentation derivations, including the Project-level six-tier conclusion used by Project Settings
 * [POS]: Pure Memory presentation derivations shared by global Memory Settings and Project Settings; user copy never falls back to embedded prose
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
import type { MemorySettings } from "../../shared/settings-ipc";

export type ProjectMemoryConclusion = Readonly<{
  copyKey:
    | "projectSettings.general.memoryDisabled"
    | "projectSettings.general.memoryPaused"
    | "projectSettings.general.memoryUnavailable"
    | "projectSettings.general.memoryScoped"
    | "projectSettings.general.memoryShared";
  delivering: boolean;
}>;

/** Health outranks scope: a broken service must never be presented as a healthy domain. */
export function projectMemoryConclusion(input: {
  memorySettings: Pick<MemorySettings, "enabled" | "paused" | "sharingMode"> | null;
  serviceStatus: Pick<MemoryStatusSnapshot, "health"> | null;
  delivering: boolean;
}): ProjectMemoryConclusion {
  const { memorySettings, serviceStatus, delivering } = input;
  if (!memorySettings?.enabled) {
    return { copyKey: "projectSettings.general.memoryDisabled", delivering };
  }
  if (memorySettings.paused) {
    return { copyKey: "projectSettings.general.memoryPaused", delivering };
  }
  if (serviceStatus?.health === "unavailable") {
    return { copyKey: "projectSettings.general.memoryUnavailable", delivering };
  }
  if (memorySettings.sharingMode === "group") {
    return { copyKey: "projectSettings.general.memoryScoped", delivering };
  }
  return { copyKey: "projectSettings.general.memoryShared", delivering };
}
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
  translate: MemoryTranslate,
  copyKey: string,
  options?: Record<string, unknown>
) => translate(copyKey, options);

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
  translate: MemoryTranslate
): MemoryBackendState {
  if (runtime && !runtime.installed && runtime.instanceId) {
    return {
      label: copy(translate, "memory.backend.interrupted"),
      tone: "warn",
    };
  }
  if (runtime?.installed) {
    if (!runtime.instanceId) {
      return {
        label: copy(translate, "memory.backend.identityRepair"),
        tone: "warn",
      };
    }
    /* 两阶段的中间态必须在卡片上就可见：EverOS 装完没提交密钥时
       服务根本起不来，「已安装」的绿色结论会和健康卡的「暂不可启用」
       同屏打架——同一事实两处两个说法，读者只会怀疑数据坏了。 */
    /* 版本不进这句话：引擎行上已经写着它了，行尾再说一遍就是同一个
       事实的第二次陈述。这里只回答「它此刻处在哪一档」。 */
    if (!runtime.configured) {
      return {
        label: copy(translate, "memory.backend.installedNeedsConfig"),
        tone: "warn",
      };
    }
    return {
      label: copy(translate, "memory.backend.installed"),
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
    label: copy(translate, "memory.backend.notInstalled"),
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

const HEALTH_ISSUE_KEYS: Record<
  MemoryHealthIssue["kind"],
  { labelKey: string; detailKey: string }
> = {
  unreachable: {
    labelKey: "memory.health.issue.unreachable.label",
    detailKey: "memory.health.issue.unreachable.detail",
  },
  unhealthy: {
    labelKey: "memory.health.issue.unhealthy.label",
    detailKey: "memory.health.issue.unhealthy.detail",
  },
  auth: {
    labelKey: "memory.health.issue.auth.label",
    detailKey: "memory.health.issue.auth.detail",
  },
  protocol: {
    labelKey: "memory.health.issue.protocol.label",
    detailKey: "memory.health.issue.protocol.detail",
  },
  identity: {
    labelKey: "memory.health.issue.identity.label",
    detailKey: "memory.health.issue.identity.detail",
  },
  configuration: {
    labelKey: "memory.health.issue.configuration.label",
    detailKey: "memory.health.issue.configuration.detail",
  },
  version: {
    labelKey: "memory.health.issue.version.label",
    detailKey: "memory.health.issue.version.detail",
  },
};

const HEALTH_VIEW: Record<
  MemoryHealth,
  { tone: MemoryTone; labelKey: string; detailKey: string }
> = {
  unknown: {
    tone: "neutral",
    labelKey: "memory.health.unknownLabel",
    detailKey: "memory.health.unknownDetail",
  },
  checking: {
    tone: "neutral",
    labelKey: "memory.health.checkingLabel",
    detailKey: "memory.health.checkingDetail",
  },
  ready: {
    tone: "ready",
    labelKey: "memory.health.readyLabel",
    detailKey: "memory.health.readyDetail",
  },
  compat: {
    tone: "warn",
    labelKey: "memory.health.compatLabel",
    detailKey: "memory.health.compatDetail",
  },
  unavailable: {
    tone: "danger",
    labelKey: "memory.health.unavailableLabel",
    detailKey: "memory.health.unavailableDetail",
  },
};

const BLOCKED_REASON_KEYS = {
  ownership: "memory.health.blocked.ownership",
  configuration: "memory.health.blocked.configuration",
  "not-installed": "memory.health.blocked.not-installed",
} as const;

export function memoryHealthView(
  enabled: boolean,
  health: MemoryHealth,
  issue: MemoryHealthIssue | null,
  translate: MemoryTranslate
): MemoryHealthView {
  if (!enabled)
    return {
      tone: "off",
      label: copy(translate, "memory.health.offLabel"),
      detail: copy(translate, "memory.health.offDetail"),
    };
  if (health === "unavailable" && issue) {
    const keys = HEALTH_ISSUE_KEYS[issue.kind];
    return {
      tone: issue.kind === "configuration" ? "warn" : "danger",
      label: copy(translate, keys.labelKey, { detail: issue.detail }),
      detail: copy(translate, keys.detailKey, { detail: issue.detail }),
    };
  }
  if (health === "compat" && issue?.kind === "version") {
    return {
      tone: "warn",
      label: copy(translate, "memory.health.compatLabel"),
      detail: copy(
        translate,
        "memory.health.compatVersionDetail",
        { version: issue.detail }
      ),
    };
  }
  const view = HEALTH_VIEW[health];
  return {
    tone: view.tone,
    label: copy(translate, view.labelKey),
    detail: copy(translate, view.detailKey),
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
  translate: MemoryTranslate
): MemoryStatusLine {
  /* 装好了却连不上：这不是库存问题而是就绪问题。它同时解释右侧那颗
     点不动的按钮——无论那是「设为当前服务」还是开关，句子都不必点名，
     指向下面那两个动作即可。 */
  const stalled = Boolean(runtime?.installed && !runtime.serviceReachable);
  const notReady = () =>
    copy(
      translate,
      "memory.backend.notReady"
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
  /* blockedReason 压过健康结论：fail-closed 的原因比「连不上」更该先说。

     但 configuration 这一条例外：它是 runtime 的投影，而 target 走的是
     更长的收敛路径（要等运行时操作跑完才 reapply）。密钥写完的那一刻
     runtime 已经 configured，target 还停在旧结论——两个真相源里近的那个
     说了算，否则用户刚提交完密钥，读到的第一句就是「尚未完成配置」，
     产品在否定他刚做过的事。 */
  const target =
    current.target?.blockedReasonCode === "configuration" && runtime?.configured
      ? null
      : current.target;
  const blocked = target?.blockedReasonCode
    ? copy(
        translate,
        BLOCKED_REASON_KEYS[target.blockedReasonCode],
        { provider: target.providerId }
      )
    : target?.blockedReason ?? null;
  if (blocked)
    return {
      tone: "warn",
      label: copy(translate, "memory.health.blockedLabel"),
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
  translate: MemoryTranslate
): MemoryMasterRow {
  const switchLabel = memory.paused
    ? copy(translate, "memory.page.resume")
    : memory.enabled
      ? copy(translate, "memory.page.pause")
      : copy(translate, "memory.page.enable");

  /* 暂停压过健康：服务跑得再好，此刻也确实什么都不记。 */
  if (memory.enabled && memory.paused)
    return {
      tone: "warn",
      label: copy(translate, "memory.page.statePaused"),
      detail: copy(
        translate,
        "memory.page.pausedBanner"
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
          "memory.page.stateUnavailable"
        ),
        /* 只说后果。病因、地址与修复动作归下面那一档服务自己讲——
           同一句诊断隔着 60px 说两遍，第二遍不会让人更确信。而
           memoryServiceNeedsAttention 保证它此刻一定是摊开的。 */
        detail: copy(
          translate,
          "memory.page.pausedBanner"
        ),
        switchChecked: true,
        switchDisabled: false,
        switchLabel,
      };
    return {
      tone: view.tone,
      /* 只说记不记。用哪个后端是它的子项自己的事——父说 whether，
         子说 which，同一个名词不在一张卡里出现两次。 */
      label: copy(translate, "memory.page.stateOn"),
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
        BLOCKED_REASON_KEYS[status.target.blockedReasonCode],
        { provider: status.target.providerId }
      )
    : (status.target?.blockedReason ?? null);
  const stuck = status.target?.canEnable === false || !gateOpen;
  return {
    tone: "off",
    label: copy(translate, "memory.health.offLabel"),
    detail: stuck
      ? blocked ||
        copy(
          translate,
          "memory.backend.notReady"
        )
      : copy(
          translate,
          "memory.health.offDetail"
        ),
    switchChecked: false,
    switchDisabled: stuck,
    switchLabel,
  };
}

/* ============================================================
 * 服务档要不要自己摊开：只有「已开启却兑现不了」才算坏掉——
 * 没装、待配置、连不上、或开着却不可用，都以 enabled 为前提。
 *
 * 关闭态不打扰：用户还没把开关拨上去，就没有任何承诺被违背，
 * 「未安装」只是还没设置，不是故障。此时服务档收成一行，
 * 状态与病因由收起的头行（及其悬停说明）自己讲，装不装由用户
 * 自己掀开决定。
 *
 * 它与主开关的 `stuck` 共用同一个 `gateOpen`，于是「点不动」与「摊开」
 * 不可能各说各话；enabled 之下 gate 没开或 `unavailable`，都保证主控行
 * 只说后果时，病因、地址与修复动作一定在同屏可见——折叠藏不住一件
 * 真正坏掉的东西。
 * ============================================================ */

export const memoryServiceNeedsAttention = (
  memory: { enabled: boolean },
  status: MemoryStatusSnapshot,
  gateOpen: boolean
) => memory.enabled && (!gateOpen || status.health === "unavailable");

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
  locale: string,
  translate: MemoryTranslate
): string {
  if (!at) return copy(translate, "memory.time.none");
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return copy(translate, "memory.time.now");
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
    copyKey: string;
    tone: MemoryTone;
  }
> = {
  used: {
    copyKey: "memory.activity.recallUsed",
    tone: "ready",
  },
  none: {
    copyKey: "memory.activity.recallNone",
    tone: "neutral",
  },
  unavailable: {
    copyKey: "memory.activity.recallFailed",
    tone: "warn",
  },
  idle: {
    copyKey: "memory.activity.lastRecall",
    tone: "off",
  },
};

export function memoryActivityStats(
  status: MemoryStatusSnapshot,
  now: number,
  locale: string,
  translate: MemoryTranslate
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
          { count: recall.failedTurns }
        )}`
      : "";
  const rebuilt: MemoryStat[] = settled
    ? [
        {
          key: "rebuild",
          group: "event",
          value: relativeMoment(settled.startedAt, now, locale, translate),
          label: copy(translate, "memory.activity.rebuilt"),
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
      label: copy(translate, "memory.activity.lastCapture"),
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
        copy(translate, recallEvent.copyKey, {
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
      label: copy(translate, "memory.activity.delivered"),
      tone: deliveredTurns > 0 ? "neutral" : "off",
      at: null,
    },
    {
      key: "pending",
      group: "counter",
      value: `${pendingTurns}`,
      label: copy(translate, "memory.activity.pending"),
      tone: pendingTurns > 0 ? "neutral" : "off",
      at: null,
    },
    {
      key: "inflight",
      group: "counter",
      value: `${inflightBatches}`,
      label: copy(translate, "memory.activity.inflight"),
      tone: inflightBatches > 0 ? "neutral" : "off",
      at: null,
    },
    /* gap 必须永远出现：把「授权过但已经发不出去」的事实藏起来，
       就是在 0/0/0 的表象下宣称记忆是完整的。 */
    {
      key: "gap",
      group: "counter",
      value: `${gapTurns}`,
      label: copy(translate, "memory.activity.gap"),
      tone: gapTurns > 0 ? "warn" : "off",
      at: null,
    },
    /* key 是给 testid 与调试用的稳定标识，不是标签的拼音缩写：
       recallused 读起来像一个词，recall-used 才看得出它由两段构成。 */
    {
      key: "recall-used",
      group: "counter",
      value: `${recall.usedTurns}`,
      label: copy(translate, "memory.activity.recallUsedTurns"),
      tone: recall.usedTurns > 0 ? "ready" : "off",
      at: null,
    },
    {
      key: "recall-zero",
      group: "counter",
      value: `${recall.zeroTurns}`,
      label: copy(translate, "memory.activity.recallZeroTurns"),
      tone: recall.zeroTurns > 0 ? "neutral" : "off",
      at: null,
    },
    /* 这里曾有第五格「待处置挂起」，值就是 attention.length。它把
       下方「需要处置」逐条铺开的同一批事项又数了一遍，读者得自己
       确认两处说的是不是一回事；四列网格里它还永远孤零零掉到第二行。
       一个数字若在别处已被完整讲述，它就不是指标，只是回声。 */
  ];
}

const ATTENTION_LABEL_KEYS: Record<MemoryAttentionKind, string> = {
  "capture-gap": "memory.attention.kind.capture-gap",
  "cleanup-failed": "memory.attention.kind.cleanup-failed",
  "rebuild-failed": "memory.attention.kind.rebuild-failed",
  "capacity-pressure": "memory.attention.kind.capacity-pressure",
};

const ATTENTION_ACTION_LABEL_KEYS: Record<MemoryAttentionAction, string> = {
  acknowledge: "memory.attention.action.acknowledge",
  "retry-cleanup": "memory.attention.action.retry-cleanup",
  compact: "memory.attention.action.compact",
  abandon: "memory.attention.action.abandon",
  "resume-rebuild": "memory.attention.action.resume-rebuild",
};

const REBUILD_PHASE_LABEL_KEYS: Record<MemoryRebuildPhase, string> = {
  prepared: "memory.rebuild.phase.prepared",
  quiescing: "memory.rebuild.phase.quiescing",
  reconciling: "memory.rebuild.phase.reconciling",
  purging: "memory.rebuild.phase.purging",
  "watermarks-cleared": "memory.rebuild.phase.watermarks-cleared",
  backfilling: "memory.rebuild.phase.backfilling",
  completed: "memory.rebuild.phase.completed",
  failed: "memory.rebuild.phase.failed",
};

export function attentionLabel(
  kind: MemoryAttentionKind,
  translate: MemoryTranslate
) {
  return copy(translate, ATTENTION_LABEL_KEYS[kind]);
}

export function attentionActionLabel(
  action: MemoryAttentionAction,
  translate: MemoryTranslate
) {
  return copy(translate, ATTENTION_ACTION_LABEL_KEYS[action]);
}

export function rebuildPhaseLabel(
  phase: MemoryRebuildPhase,
  translate: MemoryTranslate
) {
  return copy(translate, REBUILD_PHASE_LABEL_KEYS[phase]);
}
