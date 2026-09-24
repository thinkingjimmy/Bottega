/**
 * [INPUT]: Depends on Setup installation checks, backend identities, installation admission, the Settings list primitives, SetupRowTile and localized recovery controls.
 * [OUTPUT]: Provides the onboarding Agent list card: one row per Agent with an Installed badge and check, a sign-in action for signed-out CLIs, or an install action.
 * [POS]: The single Agent setup surface (install and sign-in); Settings › Providers links here, Settings › Updates owns versions.
 */
import { Check, Download, LogIn } from "lucide-react";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { Skeleton } from "@ai-chat/ui/components/ui/skeleton";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { useSetup } from "@/components/providers/setup-provider";
import { useSetupRefresh } from "@/components/providers/availability/use-setup-refresh";
import { SettingsBadge, SettingsButton, SettingsList, SettingsRow } from "@/components/settings/settings-layout";
import { AgentBackendIcon } from "@/lib/agent-backends";
import { isAgentInstalled } from "@/lib/onboarding-gate";
import { AGENT_BACKEND_ORDER, type AgentBackendId, type BackendInfo } from "../../../shared/agent-ipc";
import { SetupFeedbackNotice } from "./backend-feedback";
import { backendSetupPresentation } from "./backend-parts";
import { SetupRowTile } from "./row-tile";

const ABOUT_KEYS = {
  codex: "onboarding.agentAbout.codex",
  claude: "onboarding.agentAbout.claude",
  kimi: "onboarding.agentAbout.kimi",
  opencode: "onboarding.agentAbout.opencode",
} as const satisfies Record<AgentBackendId, string>;

function InstallationRow({ backend }: { backend: BackendInfo }) {
  const { t } = useAppTranslation();
  const setup = useSetup();
  const busy = Boolean(setup.busy[backend.id]);
  const installed = isAgentInstalled(backend);
  const waiting = Boolean(backend.setupAction);
  const checking = !waiting && (backend.runtimeStatus === "unknown" || setup.busy[backend.id] === "recheck");
  const checkFailed = backend.runtimeStatus === "error";
  const feedback = setup.feedback[backend.id];
  /* Onboarding is the one place Agents are set up, so an installed CLI that is signed out gets its sign-in here. */
  const signIn = installed && backendSetupPresentation(backend, setup.now).loginAction === "login";
  const retryOperation = feedback?.operation === "login" ? "login" : "install";
  const description = !installed && (waiting || checking)
    ? <span role="status">{t(waiting ? "onboarding.agentInstalling" : "onboarding.agentChecking")}</span>
    : !installed && checkFailed && !feedback ? <span role="status">{t("onboarding.agentCheckFailed")}</span>
      : t(ABOUT_KEYS[backend.id]);
  const control = signIn ? <SettingsButton variant="outline" disabled={busy} onClick={() => void setup.terminalAction(backend.id, "login")}>
      {busy ? <Spinner className="size-3.5" /> : <LogIn />}{t("setup.login")}
    </SettingsButton>
    : installed ? <Check className="size-4 text-emerald-700 dark:text-emerald-400" strokeWidth={2.2} aria-hidden="true" />
    : waiting || checking ? <Spinner className="size-4 text-muted-foreground" />
    : checkFailed ? <SettingsButton variant="outline" disabled={busy} onClick={() => void setup.recheckBackend(backend.id)}>{t("setup.checkAgain")}</SettingsButton>
    : <SettingsButton variant="outline" disabled={busy} onClick={() => void setup.terminalAction(backend.id, "install")}>
      {busy ? <Spinner className="size-3.5" /> : <Download />}{t("setup.install")}
    </SettingsButton>;
  return <div role="group" aria-label={backend.displayName} aria-busy={checking || waiting}>
    <SettingsRow leading={<SetupRowTile><AgentBackendIcon backend={backend.id} className="size-5" /></SetupRowTile>}
      label={backend.displayName} description={description} control={control}
      badge={installed && <SettingsBadge>{t("onboarding.agentInstalled")}</SettingsBadge>} />
    {feedback && <div className="pr-4 pb-3 pl-[76px]"><SetupFeedbackNotice feedback={feedback} disabled={busy}
      onRetry={() => void (feedback.kind === "clipboard" || feedback.operation === "check"
        ? setup.recheckBackend(backend.id) : setup.terminalAction(backend.id, retryOperation))} /></div>}
  </div>;
}

export function OnboardingAgents() {
  const setup = useSetup();
  useSetupRefresh();
  return <>
    <SettingsList>
      {setup.status ? setup.status.backends.map((backend) => <InstallationRow key={backend.id} backend={backend} />)
        : AGENT_BACKEND_ORDER.map((id) => <div key={id} className="flex items-center gap-6 px-4 py-3">
          <Skeleton className="size-9 rounded-[9px]" />
          <div className="flex flex-1 flex-col gap-1.5"><Skeleton className="h-3 w-20" /><Skeleton className="h-3 w-40" /></div>
          <Skeleton className="h-8 w-20 rounded-md" />
        </div>)}
    </SettingsList>
    {setup.error && <SetupFeedbackNotice feedback={setup.error} onRetry={() => void setup.refreshIfNeeded()} disabled={setup.checking} />}
  </>;
}
