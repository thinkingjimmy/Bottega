/**
 * [INPUT]: The single onboarding path, the requirement verdict, shared step/caption presentation and the step bodies.
 * [OUTPUT]: Centered onboarding with one path — folder, Agent (with a recorded Install later exemption), optional capabilities — and one completion.
 * [POS]: Main-window onboarding composition; required facts stay in the setup provider, and the account is never consulted here.
 */
import { useEffect, useRef, useState } from "react";
import { SetupStep, setupStepCaption } from "@ai-chat/ui/components/ui/setup-step";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { TooltipProvider } from "@ai-chat/ui/components/ui/tooltip";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { useSetup } from "@/components/providers/setup-provider";
import { PRODUCT_NAME } from "@ai-chat/ui/components/workspace/brand";
import { isApplePlatform } from "@/lib/platform";
import { settingsStore } from "@/lib/settings-store";
import { initialOnboardingStep, onboardingSteps, type OnboardingStep } from "./plan";
import { FolderStep } from "./steps/folder";
import { OnboardingAgents } from "@/components/setup/onboarding-agents";
import { ExtrasStep } from "./steps/extras";

export function OnboardingView() {
  const { t } = useAppTranslation(), setup = useSetup();
  const [step, setStep] = useState<OnboardingStep | null>(null), [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState(""), [deferring, setDeferring] = useState(false);
  const entered = useRef(false), finishingLock = useRef(false);
  useEffect(() => {
    if (entered.current) return;
    entered.current = true; setup.holdOnboarding();
  }, [setup]);
  const seed = initialOnboardingStep({ facts: setup.onboarding.facts, target: setup.onboardingTarget });
  if (!step && seed) setStep(seed);

  const finish = async (agentReady: boolean) => {
    if (finishingLock.current || !agentReady) return;
    finishingLock.current = true; setFinishing(true); setFinishError("");
    if (settingsStore.getSnapshot().settings?.skillsOnboarding === "pending") {
      const saved = await settingsStore.update({ skillsOnboarding: "skipped" }, t("onboarding.skillsUpdateFailed"));
      if (!saved) { setFinishError(t("onboarding.skillsUpdateFailed")); finishingLock.current = false; setFinishing(false); return; }
    }
    setup.leaveOnboarding();
  };
  /* Install later is a recorded fact, not a bypass: it is saved before the step advances, so a relaunch does not ask again. */
  const agentReady = setup.onboarding.facts.agent === "satisfied";
  const labels = onboardingSteps.map(id => t(`onboarding.step.${id === "folder" ? "chat-home" : id}`));
  const id = step === "folder" || !step ? "chat-home" : step;
  const last = step === "extras";
  const blocked = step === "agent" && !agentReady;
  const advance = (ready: boolean) => { if (last) void finish(ready); else setStep("extras"); };
  const deferAgent = async () => {
    if (deferring || finishing) return;
    setDeferring(true); setFinishError("");
    const saved = await settingsStore.update({ agentSetupDeferred: true }, t("onboarding.agentLaterFailed"), { errorScope: "local" });
    setDeferring(false);
    if (!saved) { setFinishError(t("onboarding.agentLaterFailed")); return; }
    advance(true);
  };
  /* The folder is irreversible and the Agent step is the one after it, so Back exists only on the last step. */
  const footer = step && step !== "folder" ? <>
    {last ? <Button size="lg" variant="ghost" disabled={finishing} onClick={() => setStep("agent")}>{t("onboarding.back")}</Button> : <span />}
    <div className="ml-auto flex min-w-0 flex-col items-end gap-2">
      {finishError && <p role="alert" className="text-sm text-destructive">{finishError}</p>}
      {blocked && <p role="status" className="text-right text-xs text-muted-foreground">{t("onboarding.description.agent")}</p>}
      <div className="flex items-center gap-2">
        {step === "agent" && !agentReady && <Button size="lg" variant="ghost" disabled={finishing || deferring} onClick={() => void deferAgent()}>
          {deferring && <Spinner className="size-3.5" />}{t("onboarding.agentLater")}
        </Button>}
        <Button size="lg" disabled={blocked || finishing} onClick={() => advance(agentReady)}>
          {finishing && <Spinner className="size-3.5" />}{t(last ? "onboarding.start" : "onboarding.next")}
        </Button>
      </div>
    </div>
  </> : undefined;
  return <TooltipProvider><div className="relative flex h-svh min-w-0 flex-col overflow-hidden bg-background">
    {isApplePlatform() && <div className="h-10 shrink-0 [-webkit-app-region:drag]" />}
    <SlimScroller className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[clamp(2rem,5vw,4rem)] py-6">
      <div className="m-auto flex w-full max-w-[520px] flex-col gap-5">
        {!step ? <div role="status" className="flex justify-center gap-2 text-sm text-muted-foreground"><Spinner />{t("cloud.status.connecting")}</div> :
          <SetupStep steps={labels} step={onboardingSteps.indexOf(step)} caption={setupStepCaption(onboardingSteps.indexOf(step), labels, t("common.stepOf", { current: onboardingSteps.indexOf(step) + 1, total: onboardingSteps.length }))}
            title={t(`onboarding.heading.${id}`, { product: PRODUCT_NAME })} description={t(`onboarding.description.${id}`)} footer={footer}>
            {step === "folder" && <FolderStep onSelected={() => setStep("agent")} />}
            {step === "agent" && <OnboardingAgents />}
            {step === "extras" && <ExtrasStep finishing={finishing} />}
          </SetupStep>}
      </div>
    </SlimScroller>
  </div></TooltipProvider>;
}
