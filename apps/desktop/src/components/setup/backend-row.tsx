/**
 * [INPUT]: Depends on SetupProvider's shared clock/actions, localized setup guidance, backend identity and backend-parts' presentation projection.
 * [OUTPUT]: Renders compact Agent setup rows with known versions, verification recovery guidance, badge/refresh progress and no repeated checking subtitle.
 * [POS]: The setup module's only row form, consumed by Backends Settings and Onboarding without reinterpreting backend state
 */

import { Download, Info, LogIn, RefreshCw } from "lucide-react";
import { useSetup } from "@/components/providers/setup-provider";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { SettingsButton } from "@/components/settings/settings-layout";
import { AgentBackendIcon, backendGuideKey } from "@/lib/agent-backends";
import type { BackendInfo } from "../../../shared/agent-ipc";
import {
  BackendIconAction,
  BackendStatusBadge,
  backendSetupPresentation,
} from "./backend-parts";

export function SetupBackendRow({ backend }: { backend: BackendInfo }) {
  const setup = useSetup();
  const { t } = useAppTranslation();
  const busy = Boolean(setup.busy[backend.id]);
  const presentation = backendSetupPresentation(backend, setup.now);
  const checking = presentation.refreshing || setup.busy[backend.id] === "recheck" ||
    Boolean(setup.latestChecking[backend.id]);
  const guide = presentation.showGuide && !presentation.canInstall
    ? t(backendGuideKey(backend)) : "";
  const verificationHints = {
    checking: "",
    unverified: t("setup.verification.unverified"),
    expired: t("setup.verification.expired"),
    failed: t("setup.verification.failed"),
  };
  const hint = presentation.hint ? verificationHints[presentation.hint] : guide;

  return (
    <div role="group" aria-label={backend.displayName} className="px-4 py-2.5">
      <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2">
        <AgentBackendIcon backend={backend.id} className="size-4 shrink-0" />
        <span className="w-24 shrink-0 truncate font-medium text-sm">
          {backend.displayName}
        </span>
        <BackendStatusBadge tone={presentation.tone}>
          {t(`agentAvailability.state.${presentation.status}`)}
        </BackendStatusBadge>
        {backend.version && (
          <span
            className="min-w-0 truncate font-mono text-[11px] text-muted-foreground"
            title={backend.path}
          >
            {`v${backend.version}`}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {presentation.canInstall && (
            <SettingsButton
              variant="outline"
              disabled={busy}
              onClick={() => void setup.terminalAction(backend.id, "install")}
            >
              <Download /> {t("setup.install")}
            </SettingsButton>
          )}
          {presentation.loginAction && (
            <SettingsButton
              variant="outline"
              disabled={busy || presentation.refreshing}
              onClick={() => void setup.terminalAction(backend.id, "login")}
            >
              <LogIn />
              {presentation.loginAction === "manage"
                ? t("setup.manageLogin")
                : t("setup.login")}
            </SettingsButton>
          )}
          {presentation.canUpdate && (
            <SettingsButton
              aria-label={t("setup.updateAria", { backend: backend.displayName })}
              title={backend.latestVersion}
              variant="outline"
              disabled={busy}
              onClick={() => void setup.terminalAction(backend.id, "update")}
            >
              <RefreshCw /> {t("setup.update")}
            </SettingsButton>
          )}
          {backend.reason && (
            <BackendIconAction
              label={t("setup.details", { backend: backend.displayName })}
              detail={
                <span className="flex flex-col gap-1">
                  <span className="font-medium">{t("agentFailure.technicalDetails")}</span>
                  <span className="line-clamp-6 break-words font-mono text-[11px]">
                    {backend.reason}
                  </span>
                </span>
              }
            >
              <Info />
            </BackendIconAction>
          )}
          <BackendIconAction
            label={t("setup.recheck", { backend: backend.displayName })}
            disabled={busy || checking}
            onClick={() => void setup.recheckBackend(backend.id)}
          >
            <RefreshCw className={checking ? "animate-spin" : undefined} />
          </BackendIconAction>
        </div>
      </div>
      {hint && <p className="pt-1 pl-7 text-xs text-muted-foreground" role="status">{hint}</p>}
    </div>
  );
}
