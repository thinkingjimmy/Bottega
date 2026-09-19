/**
 * [INPUT]: Confirmed account state, selected usage mode and localized copy.
 * [OUTPUT]: ModeStep with native keyboard radio selection and visible protocol blockers.
 * [POS]: Optional path choice after the library is ready; owns no persisted preference.
 */
import type { CloudAccountState } from "../../../../shared/cloud-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { accountModeBlocked, type OnboardingMode } from "../plan";

export function ModeStep({ state, mode, onChange }: {
  state: CloudAccountState; mode: OnboardingMode; onChange: (mode: OnboardingMode) => void;
}) {
  const { t } = useAppTranslation();
  const blocked = accountModeBlocked(state);
  const modes: OnboardingMode[] = window.cloud ? ["local", "account"] : ["local"];
  return <fieldset className="space-y-3">
    <legend className="sr-only">{t("onboarding.step.mode")}</legend>
    {modes.map(value => <label key={value} className="flex cursor-pointer items-start gap-3 rounded-md p-4 ring-1 ring-inset ring-foreground/15 has-checked:ring-foreground has-disabled:cursor-default has-disabled:opacity-60">
      <input type="radio" name="onboarding-mode" className="mt-0.5 size-4 shrink-0 accent-foreground"
        checked={mode === value} disabled={Boolean(state.profile) || value === "account" && blocked}
        onChange={() => onChange(value)} />
      <span className="min-w-0"><span className="block font-medium text-sm">{t(`onboarding.mode.${value}.title`)}</span>
        <span className="mt-1 block text-sm text-muted-foreground">{t(`onboarding.mode.${value}.description`)}</span></span>
    </label>)}
    {window.cloud && blocked && <p role="status" className="text-sm text-muted-foreground">{t("onboarding.accountUnavailable")} {t(`cloud.status.${state.status}`)}</p>}
  </fieldset>;
}
