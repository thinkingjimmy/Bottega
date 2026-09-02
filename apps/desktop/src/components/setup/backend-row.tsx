/**
 * [INPUT]: Depends on SetupProvider, i18n setup directory, agent-backends brand icons and instructions for keystrokes, backend-parts markup/icon action/action determination, settings-layout SettingsButton
 * [OUTPUT]: Provides SetupBackendRow with localized recovery guidance and explicitly disclosed technical diagnostics for Backends settings and Onboarding
 * [POS]: The setup module's row form; now the only form after the card was retired, sharing its criteria and parts with backend-parts
 */

import { Download, Info, LogIn, RefreshCw, Terminal } from "lucide-react";
import { useSetup } from "@/components/providers/setup-provider";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { SettingsButton } from "@/components/settings/settings-layout";
import { AgentBackendIcon, backendGuideKey } from "@/lib/agent-backends";
import type { BackendInfo } from "../../../shared/agent-ipc";
import {
  BackendIconAction,
  BackendStatusBadge,
  backendActionFlags,
} from "./backend-parts";

/* ============================================================
 * 为什么引导页不复用那张卡。
 *
 * 卡片网格在 768px 的容器里只解得出三列，第四个后端必然独占一行，
 * 留下一个与内容无关的洞；而一张就绪卡 116px 高，装的只是名字、版本号
 * 和两个图标。行把同样的信息压到 52px，并且后端再多也只是多一行——
 * 这正是 Settings › General 的 SettingsList 一直在用的形态。
 *
 * 名字列定宽：四家名字长短不一，不定宽则版本号列会跟着长短跳，
 * 一眼扫下去对不齐。
 * ============================================================ */
export function SetupBackendRow({ backend }: { backend: BackendInfo }) {
  const setup = useSetup();
  const { t } = useAppTranslation();
  const busy = Boolean(setup.busy[backend.id]);
  const { ready, canInstall, canLogin, canUpdate } = backendActionFlags(backend);
  /* 指令是产品的话（随语言变），诊断是 CLI 的原文（永不翻译）。两者都不
     定长，故都不上行内——行高于是不是文案长度的函数，而是结构常量。 */
  const guide = ready ? "" : t(backendGuideKey(backend));

  return (
    <div className="flex min-h-[52px] items-center gap-3 px-4 py-2.5">
      <AgentBackendIcon backend={backend.id} className="size-4 shrink-0" />
      <span className="w-24 shrink-0 truncate font-medium text-sm">
        {backend.displayName}
      </span>
      {/* 徽标紧跟名字：状态是名字的限定语（「Codex——未安装」），不是行尾
          的一枚孤立标签。名字定宽，故一列徽标从同一个 x 起排，扫一眼就知道
          哪几家不可用；从前它被 ml-auto 甩到最右，与真正该在右侧的动作抢位。 */}
      <BackendStatusBadge ready={ready}>
        {t(`setup.status.${backend.status}`)}
      </BackendStatusBadge>
      {/* 版本是安装位置的对外身份；完整路径只在 hover 时兑现，不占版面 */}
      <span
        className="min-w-0 truncate font-mono text-[11px] text-muted-foreground"
        title={backend.path}
      >
        {backend.version ? `v${backend.version}` : "—"}
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {/* 卡片里 Install 是实心的——一张卡只有一颗，实心正好。行列表里四颗
            并排，实心就成了页面上最重的一片黑，反而压过底部真正的下一步。
            行内三个动作统一 outline，主行动的位置只留给动作条。 */}
        {canInstall && (
          <SettingsButton
            variant="outline"
            disabled={busy}
            onClick={() => void setup.terminalAction(backend.id, "install")}
          >
            <Download /> {t("setup.install")}
          </SettingsButton>
        )}
        {canLogin && (
          <SettingsButton
            variant="outline"
            disabled={busy}
            onClick={() => void setup.terminalAction(backend.id, "login")}
          >
            <LogIn /> {t("setup.login")}
          </SettingsButton>
        )}
        {canUpdate && (
          <SettingsButton
            aria-label={t("setup.updateAria", { backend: backend.displayName })}
            variant="outline"
            disabled={busy}
            onClick={() => void setup.terminalAction(backend.id, "update")}
          >
            <RefreshCw /> {t("setup.update")}
          </SettingsButton>
        )}
        {(guide || backend.reason) && (
          <BackendIconAction
            label={t("setup.details", { backend: backend.displayName })}
            detail={
              <span className="flex flex-col gap-1">
                {guide && <span>{guide}</span>}
                {backend.reason && (
                  <span className="flex flex-col gap-0.5 border-t pt-1 opacity-70">
                    <span className="font-medium">{t("agentFailure.technicalDetails")}</span>
                    <span className="line-clamp-6 break-words font-mono text-[11px]">
                      {backend.reason}
                    </span>
                  </span>
                )}
              </span>
            }
          >
            <Info />
          </BackendIconAction>
        )}
        <BackendIconAction
          label={t("setup.checkLatest", { backend: backend.displayName })}
          disabled={Boolean(setup.latestChecking[backend.id])}
          onClick={() => void setup.refreshLatest(backend.id)}
        >
          <RefreshCw
            className={
              setup.latestChecking[backend.id] ? "animate-spin" : undefined
            }
          />
        </BackendIconAction>
        <BackendIconAction
          label={t("setup.recheck", { backend: backend.displayName })}
          disabled={busy}
          onClick={() => void setup.recheckBackend(backend.id)}
        >
          <Terminal />
        </BackendIconAction>
      </div>
    </div>
  );
}
