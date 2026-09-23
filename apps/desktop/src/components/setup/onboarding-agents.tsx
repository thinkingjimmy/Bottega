/**
 * [INPUT]: Depends on Setup installation checks, backend identities, installation admission and localized recovery controls.
 * [OUTPUT]: Provides the compact onboarding Agent list: installed confirmation, a sign-in action for signed-out CLIs, or an install action.
 * [POS]: The single Agent setup surface (install and sign-in); Settings › Providers links here, Settings › Updates owns versions.
 */
import { Check, Download, LogIn } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { Skeleton } from "@ai-chat/ui/components/ui/skeleton";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { useSetup } from "@/components/providers/setup-provider";
import { useSetupRefresh } from "@/components/providers/availability/use-setup-refresh";
import { AgentBackendIcon } from "@/lib/agent-backends";
import { isAgentInstalled } from "@/lib/onboarding-gate";
import { AGENT_BACKEND_ORDER, type BackendInfo } from "../../../shared/agent-ipc";
import { SetupFeedbackNotice } from "./backend-feedback";
import { backendSetupPresentation } from "./backend-parts";

function InstallationRow({ backend }: { backend: BackendInfo }) {
  const { t } = useAppTranslation();
  const setup = useSetup();
  const busy = Boolean(setup.busy[backend.id]);
  const installed = isAgentInstalled(backend);
  const waiting = Boolean(backend.setupAction);
  const checking = !waiting && (backend.runtimeStatus === "unknown" || setup.busy[backend.id] === "recheck");
  const feedback = setup.feedback[backend.id];
  /* Onboarding is the one place Agents are set up, so an installed CLI that is signed out gets its sign-in here. */
  const signIn = installed && backendSetupPresentation(backend, setup.now).loginAction === "login";
  const retryOperation = feedback?.operation === "login" ? "login" : "install";
  return <div role="group" aria-label={backend.displayName} aria-busy={checking || waiting} className="py-3">
    <div className="flex min-h-8 flex-wrap items-center gap-3">
      <AgentBackendIcon backend={backend.id} className="size-4 shrink-0" />
      <span className="font-medium text-sm">{backend.displayName}</span>
      <div className="ml-auto flex items-center gap-2">
        {signIn ? <Button variant="outline" size="lg" disabled={busy} onClick={() => void setup.terminalAction(backend.id, "login")}>
            {busy ? <Spinner className="size-3.5" /> : <LogIn />}{t("setup.login")}
          </Button>
          : installed ? <span className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400"><Check className="size-4" aria-hidden="true" />{t("onboarding.agentInstalled")}</span>
          : waiting || checking ? <span className="flex items-center gap-2 text-xs text-muted-foreground" role="status"><Spinner className="size-3.5" />{t(waiting ? "onboarding.agentInstalling" : "onboarding.agentChecking")}</span>
          : backend.runtimeStatus === "error" ? <Button variant="outline" size="lg" disabled={busy} onClick={() => void setup.recheckBackend(backend.id)}>{t("setup.checkAgain")}</Button>
          : <Button variant="outline" size="lg" disabled={busy} onClick={() => void setup.terminalAction(backend.id, "install")}>
            {busy ? <Spinner className="size-3.5" /> : <Download />}{t("setup.install")}
          </Button>}
      </div>
    </div>
    {backend.runtimeStatus === "error" && !feedback && <p className="pl-7 pt-1 text-xs text-muted-foreground" role="status">{t("onboarding.agentCheckFailed")}</p>}
    {feedback && <div className="pl-7 pt-2"><SetupFeedbackNotice feedback={feedback} disabled={busy}
      onRetry={() => void (feedback.kind === "clipboard" || feedback.operation === "check"
        ? setup.recheckBackend(backend.id) : setup.terminalAction(backend.id, retryOperation))} /></div>}
  </div>;
}

export function OnboardingAgents() {
  const setup = useSetup();
  useSetupRefresh();
  return <>
    <div className="divide-y divide-border">
      {setup.status ? setup.status.backends.map((backend) => <InstallationRow key={backend.id} backend={backend} />)
        : AGENT_BACKEND_ORDER.map((id) => <div key={id} className="flex min-h-14 items-center gap-3 py-3"><Skeleton className="size-4 rounded" /><Skeleton className="h-3 w-20" /><Skeleton className="ml-auto h-4 w-16" /></div>)}
    </div>
    {setup.error && <SetupFeedbackNotice feedback={setup.error} onRetry={() => void setup.refreshIfNeeded()} disabled={setup.checking} />}
  </>;
}
