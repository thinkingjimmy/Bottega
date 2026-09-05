/**
 * [INPUT]: Depends on the shared UpdateSnapshot contract only — no React, no IPC, no i18n runtime
 * [OUTPUT]: Provides SidebarUpdateTone, SidebarUpdateGlyph, SidebarUpdateIntent, SidebarUpdateView and describeSidebarUpdate
 * [POS]: Sidebar 底部那颗更新按钮的结论层：更新快照到「出不出现、多重、什么字形、按下去做什么」只判一次，与 lib/about-view、lib/memory-view 同一族
 */

import type { UpdateSnapshot } from "../../shared/update-ipc";

/* ============================================================
 * 语气三档，与 lib/about-view 的 UpdateTone 同名同义，不另发明第二套：
 *   loud   —— 前景色满强度，只给真的等你按的那一相
 *   quiet  —— muted 字色，已在进行中，播报而不邀请
 *   danger —— destructive 配色，坏了但仍可按
 *
 * 这里只管**图标多重**，不管底色：底色一律没有，hover 才浮出一颗药丸，
 * 与同一行左边的 Memory 告警按钮是同一种做派。响度跟随可操作性——
 * 一颗常驻实心块会让这个临时知会冒充第四行导航。
 * ============================================================ */
export type SidebarUpdateTone = "loud" | "quiet" | "danger";

export type SidebarUpdateGlyph = "download" | "external" | "spinner" | "alert";

/* 按下去到底发生什么。三条通路必须分开命名：曾经它们共用一颗下载图标，
   于是 Windows 上那颗「下载」按下去只是开了个网页。 */
export type SidebarUpdateIntent = "install" | "releases" | "about";

type SidebarUpdateLabelKey =
  | "settings.about.upgrade"
  | "settings.about.manualUpgrade"
  | "settings.about.downloading"
  | "settings.about.installing"
  | "settings.about.failedFallback"
  | "settings.about.backgroundFailedOpen";

export type SidebarUpdateView = Readonly<{
  tone: SidebarUpdateTone;
  glyph: SidebarUpdateGlyph;
  labelKey: SidebarUpdateLabelKey;
  labelVars: Readonly<Record<string, string | number>>;
  /** 有值才画进度填充。0 也要画，故判空只认 null，不认 falsy。 */
  percent: number | null;
  /** null = 此刻它不是按钮，只是一块状态播报，不进焦点序列。
      不设第二个 actionable 布尔：一个字段无法与自己不一致。 */
  intent: SidebarUpdateIntent | null;
}>;

/* 每一相只写它与「满强度可按」的差集：默认值集中在 BASE 一处，
   新增一相时漏填的字段自动落到默认，而不是落到 undefined。 */
const BASE = Object.freeze({
  tone: "loud" as SidebarUpdateTone,
  labelVars: Object.freeze({}),
  percent: null,
});

function show(
  patch: Pick<SidebarUpdateView, "glyph" | "labelKey" | "intent"> &
    Partial<SidebarUpdateView>
): SidebarUpdateView {
  return Object.freeze({ ...BASE, ...patch });
}

/* ============================================================
 * 静息态整颗不出现，返回 null。
 *
 * 「已是最新」在任何一帧都不含新信息——它几乎永远为真，于是一颗常亮
 * 按钮只是常驻噪音；checking 那几百毫秒同理，全局 chrome 不该为一次
 * IPC 往返闪一下。这与 about-view 的判据同源：那边是不说话，这边是
 * 不占位。
 *
 * 但「失败」不是静息。撤走按钮之后，界面与「一切正常」长得一模一样，
 * 用户失去的不只是提示，是那条通路本身——自动装不上时，手动下载永远
 * 还在。后台自动检查失败同理：那条通路已经断了，用户有权在按下任何
 * 按钮之前就知道，只是它不紧急，故与进行中同用 quiet 一档，不去抢 danger。
 * ============================================================ */
export function describeSidebarUpdate(
  update: UpdateSnapshot
): SidebarUpdateView | null {
  const version = update.availableVersion ?? update.currentVersion;
  switch (update.phase) {
    case "available":
      /* 自动安装与手动下载是两条通路，字形与去向都必须跟着走。 */
      return update.automaticInstall
        ? show({
            glyph: "download",
            labelKey: "settings.about.upgrade",
            intent: "install",
          })
        : show({
            glyph: "external",
            labelKey: "settings.about.manualUpgrade",
            intent: "releases",
          });
    case "downloading": {
      const percent = Math.round(update.progress?.percent ?? 0);
      return show({
        tone: "quiet",
        glyph: "download",
        labelKey: "settings.about.downloading",
        labelVars: { version, percent },
        percent,
        intent: null,
      });
    }
    case "installing":
      return show({
        tone: "quiet",
        glyph: "spinner",
        labelKey: "settings.about.installing",
        intent: null,
      });
    case "error":
      return show({
        tone: "danger",
        glyph: "alert",
        labelKey: "settings.about.failedFallback",
        labelVars: { version },
        intent: "releases",
      });
    case "checking":
    case "not-available":
      return null;
    default:
      /* idle：后台那次自动检查失败过就不再是静息，去 About 看诊断与重试。
         这里不指向 Releases——检查失败并不意味着存在一个可下载的新版本。 */
      return update.lastError
        ? show({
            tone: "quiet",
            glyph: "alert",
            labelKey: "settings.about.backgroundFailedOpen",
            intent: "about",
          })
        : null;
  }
}
