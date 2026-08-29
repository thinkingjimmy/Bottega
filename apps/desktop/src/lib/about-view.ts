/**
 * [INPUT]: Depends on the shared UpdateSnapshot contract only — no React, no IPC, no i18n runtime
 * [OUTPUT]: Provides UpdateTone, UpdateGlyph, UpdateView, describeUpdate and formatAppDiagnostics
 * [POS]: Settings › About 的结论层：更新快照到「说不说话、说什么、多重、给哪颗按钮」只判一次，与 lib/memory-view 同一族
 */

import type { UpdateSnapshot } from "../../shared/update-ipc";

/* ============================================================
 * 语气三档，与 SettingsAlert 同一套词汇，不另发明第二种强调色：
 *   quiet  —— 灰字，与说明文字等重
 *   loud   —— 前景色 + 中等字重，强调交给旁边那颗实心按钮
 *   danger —— 唯一长出表面的一档，destructive 配色
 * ============================================================ */
export type UpdateTone = "quiet" | "loud" | "danger";

export type UpdateGlyph = "spinner" | "check" | "download" | "alert";

export type UpdateView = Readonly<{
  /** i18n 键（settings.about 下）；null = 静息态，这一行只剩一颗按钮。 */
  messageKey: string | null;
  messageVars: Readonly<Record<string, string>>;
  glyph: UpdateGlyph | null;
  tone: UpdateTone;
  /** 有值才画进度条。0 也要画，故判空只认 null，不认 falsy。 */
  percent: number | null;
  /** 检查按钮此刻按不按得动。在飞或桥不在，都算按不动。 */
  blocked: boolean;
  /** 升级按钮的文案键；null = 这一档不给升级按钮。 */
  upgradeKey: string | null;
}>;

const SILENT: UpdateView = Object.freeze({
  messageKey: null,
  messageVars: Object.freeze({}),
  glyph: null,
  tone: "quiet",
  percent: null,
  blocked: false,
  upgradeKey: null,
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
    return speak({ messageKey: "unavailable", glyph: "alert", blocked: true });
  }
  const version = update.availableVersion ?? update.currentVersion;
  switch (update.phase) {
    case "checking":
      return speak({ messageKey: "checking", glyph: "spinner", blocked: true });
    case "available":
      return speak({
        messageKey: "available",
        messageVars: { version },
        glyph: "download",
        tone: "loud",
        /* 自动安装与手动下载是两条通路，标签必须跟着走，
           否则 Windows 上写着「立即升级」按下去只是开了个网页。 */
        upgradeKey: update.automaticInstall ? "upgrade" : "manualUpgrade",
      });
    case "downloading":
      return speak({
        messageKey: "downloading",
        messageVars: { version },
        glyph: "download",
        tone: "loud",
        percent: Math.round(update.progress?.percent ?? 0),
        blocked: true,
      });
    case "installing":
      return speak({ messageKey: "installing", glyph: "check", tone: "loud", blocked: true });
    case "error":
      return speak({
        messageKey: "failed",
        /* 缺失的错误原文是诊断，不是文案，故不进 i18n 目录。 */
        messageVars: { message: update.error ?? "Unknown error" },
        glyph: "alert",
        tone: "danger",
      });
    case "not-available":
      return checkedHere
        ? speak({ messageKey: "current", glyph: "check" })
        : SILENT;
    default:
      /* 后台那次自动检查失败过，就不再是静息态：自动通道已经断了，
         用户有权在按下按钮之前就知道这件事。 */
      return update.lastError
        ? speak({ messageKey: "backgroundFailed", glyph: "alert", tone: "danger" })
        : SILENT;
  }
}

/* 复制给 issue 用的那三行：人读得懂，也能原样粘进 bug 报告。
   页面上只露版本与协议，其余事实不占版面——它们活在这里。 */
export function formatAppDiagnostics(facts: {
  productName: string;
  version: string;
  electron: string;
  platform: string;
}): string {
  return [
    `${facts.productName} ${facts.version}`,
    `Electron ${facts.electron}`,
    facts.platform,
  ].join("\n");
}
