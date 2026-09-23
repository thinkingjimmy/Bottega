/**
 * [INPUT]: Depends on the shared UpdateSnapshot contract only — no React, no IPC, no i18n runtime
 * [OUTPUT]: Provides UpdateTone, UpdateGlyph, UpdateView and describeUpdate
 * [POS]: The Bottega row of Settings › Updates' conclusion layer — turns an UpdateSnapshot into whether to speak, what to say, and which button/next step, decided once; same family as lib/memory-view
 */

import type { UpdateSnapshot } from "../../../shared/update-ipc";

/* ============================================================
 * 语气三档，与 SettingsAlert 同一套词汇，不另发明第二种强调色：
 *   quiet  —— 灰字，与说明文字等重
 *   loud   —— 前景色 + 中等字重，强调交给旁边那颗实心按钮
 *   danger —— 唯一长出表面的一档，destructive 配色
 * ============================================================ */
export type UpdateTone = "quiet" | "loud" | "danger";

export type UpdateGlyph = "spinner" | "check" | "download" | "alert";

type UpdateMessageKey =
  | "appHost.waitingDownload" | "appHost.checking" | "appHost.unavailable" | "appHost.installBusy"
  | "settings.presence.ready"
  | "settings.updates.unavailable"
  | "settings.updates.checking"
  | "settings.updates.available"
  | "settings.updates.downloading"
  | "settings.updates.installing"
  | "settings.updates.failed"
  | "settings.updates.failedUnknown"
  | "settings.updates.current"
  | "settings.updates.backgroundFailed";
type UpdateActionKey =
  | "settings.presence.restart"
  | "settings.updates.upgrade"
  | "settings.updates.manualUpgrade";
type UpdateResolutionKey = "settings.updates.failedResolution";

export type UpdateView = Readonly<{
  /** 完整 i18n 键；null = 静息态，这一行只剩一颗按钮。 */
  messageKey: UpdateMessageKey | null;
  messageVars: Readonly<Record<string, string>>;
  glyph: UpdateGlyph | null;
  tone: UpdateTone;
  /** 有值才画进度条。0 也要画，故判空只认 null，不认 falsy。 */
  percent: number | null;
  /** 检查按钮此刻按不按得动。在飞或桥不在，都算按不动。 */
  blocked: boolean;
  /** 升级按钮的文案键；null = 这一档不给升级按钮。 */
  upgradeKey: UpdateActionKey | null;
  /** 报错之后那句「怎么办」；null = 这一档没有出路可指。
      它与 tone 分开判：后台失败同样是 danger，但那条通路还没断，
      用户此刻无事可做，硬塞一句行动指令只是噪音。 */
  resolutionKey: UpdateResolutionKey | null;
}>;

const SILENT: UpdateView = Object.freeze({
  messageKey: null,
  messageVars: Object.freeze({}),
  glyph: null,
  tone: "quiet",
  percent: null,
  blocked: false,
  upgradeKey: null,
  resolutionKey: null,
});

/* 每一档只写它与静息态的差集：默认值集中在 SILENT 一处，
   新增一档时漏填的字段自动落到静息，而不是落到 undefined。 */
function speak(
  patch: Partial<UpdateView> & { messageKey: string; glyph: UpdateGlyph }
): UpdateView {
  return Object.freeze({ ...SILENT, ...patch });
}

/* ============================================================
 * 静息态不说话。
 *
 * 「已是最新」在页面打开的那一刻不含任何新信息——它是一句几乎永远
 * 为真的话，于是那行灰字只是常驻噪音，还要占掉一整行。但同一句话
 * 在**你刚按下检查之后**是必需的：一次点击必须有可见结果，否则按
 * 下去和按坏了长得一模一样。
 *
 * 所以「说不说话」的判据不是 phase 是什么，而是这个结论是不是你要
 * 来的。checkedHere 就是这唯一的一位状态，它不需要计时器，也不需要
 * 第二个 phase。
 * ============================================================ */
export function describeUpdate(
  update: UpdateSnapshot,
  checkedHere: boolean,
  bridgeReady: boolean
): UpdateView {
  /* 没有更新服务不是「静息」，是「这台机器上根本没有这条通路」。
     它与 phase 无关，故先于 switch 判掉——否则组件里要再写一遍。 */
  if (!bridgeReady) {
    return speak({ messageKey: "settings.updates.unavailable", glyph: "alert", blocked: true });
  }
  const requirement = update.appRequirement;
  if (requirement && requirement.status !== "satisfied" && requirement.status !== "error") {
    const keys = { "waiting-download": "appHost.waitingDownload", checking: "appHost.checking", unavailable: "appHost.unavailable", "install-busy": "appHost.installBusy" } as const;
    const waiting = requirement.status === "waiting-download" || requirement.status === "checking";
    return speak({ messageKey: keys[requirement.status], glyph: waiting ? "spinner" : "alert", blocked: waiting,
      percent: requirement.status === "waiting-download" && update.progress ? Math.round(update.progress.percent) : null });
  }
  const version = update.availableVersion ?? update.currentVersion;
  switch (update.phase) {
    case "checking":
      return speak({ messageKey: "settings.updates.checking", glyph: "spinner", blocked: true });
    case "available":
      return speak({
        messageKey: "settings.updates.available",
        messageVars: { version },
        glyph: "download",
        tone: "loud",
        /* 自动安装与手动下载是两条通路，标签必须跟着走，
           否则 Windows 上写着「立即升级」按下去只是开了个网页。 */
        upgradeKey: update.automaticInstall
          ? "settings.updates.upgrade"
          : "settings.updates.manualUpgrade",
      });
    case "downloading":
      return speak({
        messageKey: "settings.updates.downloading",
        messageVars: { version },
        glyph: "download",
        tone: "loud",
        percent: Math.round(update.progress?.percent ?? 0),
        blocked: true,
      });
    case "ready":
      return speak({ messageKey: "settings.presence.ready", glyph: "download", tone: "loud", upgradeKey: "settings.presence.restart" });
    case "installing":
      return speak({ messageKey: "settings.updates.installing", glyph: "check", tone: "loud", blocked: true });
    case "error":
      return speak({
        messageKey: update.error
          ? "settings.updates.failed"
          : "settings.updates.failedUnknown",
        /* 诊断原文保持原样；缺失诊断则切换到完整 catalog 句子，
           不把英文兜底伪装成外部错误内容。 */
        messageVars: update.error ? { message: update.error } : {},
        glyph: "alert",
        tone: "danger",
        /* 报错原文只说「坏了」。这次更新装不上时，人还剩两件能做的事：
           去 Releases 页手动下载，或去 GitHub 报告。不写出来，那条
           红字就是一个死胡同。 */
        resolutionKey: "settings.updates.failedResolution",
      });
    case "not-available":
      return checkedHere
        ? speak({ messageKey: "settings.updates.current", glyph: "check" })
        : SILENT;
    default:
      /* 后台那次自动检查失败过，就不再是静息态：自动通道已经断了，
         用户有权在按下按钮之前就知道这件事。 */
      return update.lastError
        ? speak({ messageKey: "settings.updates.backgroundFailed", glyph: "alert", tone: "danger" })
        : SILENT;
  }
}
