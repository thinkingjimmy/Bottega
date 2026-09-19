/**
 * [INPUT]: Depends on shared SetupStep/setupStepCaption and localized Sync step labels and progress.
 * [OUTPUT]: Provides the existing two-step SetupStep contract and stable Sync heading identifiers.
 * [POS]: Thin Sync settings adapter; desktop onboarding and Web consume the same shared surface.
 */
import { SetupStep as SharedSetupStep, setupStepCaption, type SetupStepProps as SharedSetupStepProps } from "@ai-chat/ui/components/ui/setup-step";
import { useAppTranslation } from "@/components/providers/i18n-provider";
export type SetupStepProps = Omit<SharedSetupStepProps, "steps" | "step" | "caption" | "titleId" | "descriptionId"> & { step: 0 | 1 };
export function SetupStep(props: SetupStepProps) {
  const { t } = useAppTranslation(), steps = [t("cloud.setup.signIn"), t("cloud.setup.enable")];
  return <SharedSetupStep {...props} steps={steps} caption={setupStepCaption(props.step, steps, t("common.stepOf", { current: props.step + 1, total: steps.length }))}
    titleId="sync-setup-title" descriptionId="sync-setup-description" />;
}
