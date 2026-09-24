/**
 * [INPUT]: The single onboarding path, the requirement verdict, OnboardingFrame and the step bodies.
 * [OUTPUT]: Onboarding with one path — folder, Agent (with a recorded Install later exemption), optional capabilities — and one completion.
 * [POS]: Main-window onboarding composition; required facts stay in the setup provider, and the account is never consulted here.
 */
import { useEffect, useRef, useState } from "react";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { TooltipProvider } from "@ai-chat/ui/components/ui/tooltip";
import { PRODUCT_NAME } from "@ai-chat/ui/components/workspace/brand";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { useSetup } from "@/components/providers/setup-provider";
import { SettingsButton } from "@/components/settings/settings-layout";
import { OnboardingAgents } from "@/components/setup/onboarding-agents";
import { settingsStore } from "@/lib/settings-store";
import { OnboardingFrame, onboardingCopyId } from "./frame";
import { initialOnboardingStep, type OnboardingStep } from "./plan";
import { ExtrasStep } from "./steps/extras";
import { FolderStep } from "./steps/folder";

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
  /* The folder advances itself once it opens, and it is irreversible: the folder step has no footer actions,
     and Back exists only on the last step, because the Agent step is the one right after the folder. */
  const footer = step && step !== "folder" ? <>
    {last && <SettingsButton variant="ghost" disabled={finishing} onClick={() => setStep("agent")}>{t("onboarding.back")}</SettingsButton>}
    <span className="flex-1" />
    {finishError && <p role="alert" className="min-w-0 truncate text-destructive text-xs" title={finishError}>{finishError}</p>}
    {blocked && <SettingsButton variant="ghost" disabled={finishing || deferring} onClick={() => void deferAgent()}>
      {deferring && <Spinner className="size-3.5" />}{t("onboarding.agentLater")}
    </SettingsButton>}
    <SettingsButton disabled={blocked || finishing} onClick={() => advance(agentReady)}>
      {finishing && <Spinner className="size-3.5" />}{t(last ? "onboarding.start" : "onboarding.next")}
    </SettingsButton>
  </> : undefined;
  const id = step ? onboardingCopyId(step) : null;
  return <TooltipProvider>
    <OnboardingFrame step={step} footer={footer}
      title={id ? t(`onboarding.heading.${id}`, { product: PRODUCT_NAME }) : undefined}
      description={id ? t(`onboarding.description.${id}`, { product: PRODUCT_NAME }) : undefined}>
      {!step && <div role="status" className="flex justify-center gap-2 py-16 text-muted-foreground text-sm"><Spinner />{t("cloud.status.connecting")}</div>}
      {step === "folder" && <FolderStep onSelected={() => setStep("agent")} />}
      {step === "agent" && <OnboardingAgents />}
      {step === "extras" && <ExtrasStep finishing={finishing} />}
    </OnboardingFrame>
  </TooltipProvider>;
}
