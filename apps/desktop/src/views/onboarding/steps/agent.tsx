/**
 * [INPUT]: Installation-only Agent rows and account-fenced persistent device preferences.
 * [OUTPUT]: AgentStep with local installation or a remote desktop selection.
 * [POS]: Requirement presentation; live send eligibility never changes onboarding admission.
 */
import { useState } from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { OnboardingAgents } from "@/components/setup/onboarding-agents";
import { DefaultExecutionDeviceList, useDefaultExecutionDevice } from "@/components/setup/default-execution-device";
import type { OnboardingMode } from "../plan";

export function AgentStep({ mode }: { mode: OnboardingMode }) {
  const { t } = useAppTranslation(), preference = useDefaultExecutionDevice();
  const [place, setPlace] = useState<"local" | "remote">(preference.deviceId ? "remote" : "local");
  const remote = mode === "account" && preference.available;
  return <div className="space-y-4">
    {remote ? <div role="group" aria-label={preference.copy.computer} className="flex rounded-md bg-muted p-1">
      {(["local", "remote"] as const).map(value => <button key={value} type="button" aria-pressed={place === value}
        className="min-w-0 flex-1 rounded px-3 py-2 text-sm aria-pressed:bg-background aria-pressed:shadow-sm"
        onClick={() => setPlace(value)}>{t(`onboarding.agentPlace.${value}`)}</button>)}
    </div> : mode === "account" && <p role="status" className="text-sm text-muted-foreground">{preference.copy.disabled}</p>}
    {remote && place === "remote" ? <DefaultExecutionDeviceList preference={preference} /> : <OnboardingAgents />}
  </div>;
}
