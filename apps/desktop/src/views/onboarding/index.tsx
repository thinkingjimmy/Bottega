/**
 * [INPUT]: Pure onboarding plans, requirement verdict, confirmed account snapshots, shared step/caption presentation and step bodies.
 * [OUTPUT]: Centered local/account onboarding with a retained session, reachable Agent destinations under protocol blockers and one completion path.
 * [POS]: Main-window onboarding composition; required facts remain in the setup provider and account authority in main.
 */
import { useEffect, useRef, useState } from "react";
import { SetupStep, setupStepCaption } from "@ai-chat/ui/components/ui/setup-step";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { TooltipProvider } from "@ai-chat/ui/components/ui/tooltip";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { useSetup } from "@/components/providers/setup-provider";
import { useCloudAccount, useCloudAccountLoaded } from "@/lib/cloud/client";
import { PRODUCT_NAME } from "@ai-chat/ui/components/workspace/brand";
import { isApplePlatform } from "@/lib/platform";
import { settingsStore } from "@/lib/settings-store";
import { accountComplete, initialOnboardingCursor, modeDestination, onboardingSteps, type OnboardingCursor, type OnboardingStep } from "./plan";
import { FolderStep } from "./steps/folder";
import { ModeStep } from "./steps/mode";
import { AccountStep } from "./steps/account";
import { AgentStep } from "./steps/agent";
import { ExtrasStep } from "./steps/extras";

export function OnboardingView() {
  const { t } = useAppTranslation(), setup = useSetup();
  const account = useCloudAccount(), accountLoaded = useCloudAccountLoaded();
  const [cursor, setCursor] = useState<OnboardingCursor | null>(null), [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState("");
  const entered = useRef(false), finishingLock = useRef(false);
  useEffect(() => {
    if (entered.current) return;
    entered.current = true; setup.holdOnboarding();
  }, [setup]);
  const seed = initialOnboardingCursor({ facts: setup.onboarding.facts, account, accountLoaded, target: setup.onboardingTarget });
  if (!cursor && seed) setCursor(seed);
  // Account completion is projected, including after a browser approval while this page was hidden.
  if (cursor?.step === "account" && accountComplete(account)) setCursor({ ...cursor, step: "agent" });
  if (cursor?.step === "mode" && account.profile && cursor.mode !== "account") setCursor({ ...cursor, mode: "account" });

  const finish = async () => {
    if (finishingLock.current || setup.onboarding.facts.agent !== "satisfied") return;
    finishingLock.current = true; setFinishing(true); setFinishError("");
    const current = settingsStore.getSnapshot().settings;
    if (current?.skillsOnboarding === "pending" || cursor?.mode === "account" && current?.skillsOnboarding !== "skipped") {
      const saved = await settingsStore.update({ skillsOnboarding: "skipped" }, t("onboarding.skillsUpdateFailed"));
      if (!saved) { setFinishError(t("onboarding.skillsUpdateFailed")); finishingLock.current = false; setFinishing(false); return; }
    }
    setup.leaveOnboarding();
  };
  const go = (step: OnboardingStep) => setCursor(value => value && ({ ...value, step }));
  const selectedFolder = () => setCursor({ mode: account.profile ? "account" : "local", step: "mode" });
  const step = cursor?.step, mode = cursor?.mode ?? "local", plan = onboardingSteps(mode);
  const labels = plan.map(id => t(`onboarding.step.${id === "folder" ? "chat-home" : id}`));
  const id = step === "folder" ? "chat-home" : step === "account" || !step ? "agent" : step;
  const last = step === "extras" || step === "agent" && mode === "account";
  const next = step === "mode" ? modeDestination(mode, account) : "extras";
  const blocked = step === "agent" && setup.onboarding.facts.agent !== "satisfied" ||
    step === "mode" && (!accountLoaded || !next);
  const back = step === "extras" ? "agent" : "mode";
  const footer = step && step !== "folder" ? <>
    {step !== "mode" ? <Button size="lg" variant="ghost" disabled={finishing} onClick={() => go(back)}>{t("onboarding.back")}</Button> : <span />}
    <div className="ml-auto flex min-w-0 flex-col items-end gap-2">
      {finishError && <p role="alert" className="text-sm text-destructive">{finishError}</p>}
      {blocked && <p role="status" className="text-right text-xs text-muted-foreground">{step === "agent" ? t("onboarding.description.agent") : !accountLoaded ? t("cloud.status.connecting") : t("onboarding.accountUnavailable")}</p>}
      <Button size="lg" disabled={blocked || finishing} onClick={last ? () => void finish() : () => { if (next) go(next); }}>
        {finishing && <Spinner className="size-3.5" />}{t(last ? "onboarding.start" : "onboarding.next")}
      </Button>
    </div>
  </> : undefined;
  return <TooltipProvider><div className="relative flex h-svh min-w-0 flex-col overflow-hidden bg-background">
    {isApplePlatform() && <div className="h-10 shrink-0 [-webkit-app-region:drag]" />}
    <SlimScroller className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[clamp(2rem,5vw,4rem)] py-6">
      <div className="m-auto flex w-full max-w-[520px] flex-col gap-5">
        {!cursor || step === "mode" && !accountLoaded ? <div role="status" className="flex justify-center gap-2 text-sm text-muted-foreground"><Spinner />{t("cloud.status.connecting")}</div> :
          step === "account" ? <AccountStep state={account} steps={labels} onBack={() => go("mode")} /> :
            <SetupStep steps={labels} step={plan.indexOf(step!)} caption={setupStepCaption(plan.indexOf(step!), labels, t("common.stepOf", { current: plan.indexOf(step!) + 1, total: plan.length }))}
              title={t(`onboarding.heading.${id}`, { product: PRODUCT_NAME })} description={t(`onboarding.description.${id}`)} footer={footer}>
              {step === "folder" && <FolderStep onSelected={selectedFolder} />}
              {step === "mode" && <ModeStep state={account} mode={mode} onChange={value => setCursor({ mode: value, step: "mode" })} />}
              {step === "agent" && <AgentStep mode={mode} />}
              {step === "extras" && <ExtrasStep finishing={finishing} />}
            </SetupStep>}
      </div>
    </SlimScroller>
  </div></TooltipProvider>;
}
