/**
 * [INPUT]: Depends on the memory setup flow, the shared Dialog root and StepDialogContent shell, SettingsButton, lucide Download/Loader2 and i18n
 * [OUTPUT]: Provides MemorySetupDialog — the three-step memory setup as the shared step dialog: "Step n of 3" progress, a per-step title and description, the flow's body, and a footer band (Back · Cancel · primary; a running install offers only Continue in Background); it closes itself once the target passes the configuration gate
 * [POS]: The one memory setup surface, opened from the Settings › Memory not-set-up row and from onboarding's optional step; the flow is mounted only while open, so every opening starts on the runtime's own step
 */

import { useEffect } from "react";
import { Download, Loader2 } from "lucide-react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { SettingsButton } from "@/components/settings/settings-layout";
import { StepDialogContent } from "@ai-chat/ui/components/ui/app-dialog";
import { Dialog } from "@ai-chat/ui/components/ui/dialog";
import { useMemorySetupFlow, type MemorySetupProps } from "./memory-setup";

export function MemorySetupDialog({
  open,
  onOpenChange,
  ...props
}: { open: boolean; onOpenChange(next: boolean): void } & MemorySetupProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <SetupFlow {...props} onClose={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function SetupFlow({ onClose, ...props }: MemorySetupProps & { onClose(): void }) {
  const { t } = useAppTranslation();
  const flow = useMemorySetupFlow(props);
  /* Submitting the key is the last step; once the runtime confirms it, the dialog has nothing left to ask. */
  useEffect(() => {
    if (flow.done) onClose();
  }, [flow.done, onClose]);
  const primary = flow.primary;
  return (
    <StepDialogContent
      data-memory-setup-dialog=""
      progress={{
        index: flow.step,
        total: flow.total,
        label: t("common.stepOf", { current: flow.step, total: flow.total }),
      }}
      title={flow.title}
      description={flow.description}
      back={
        flow.back ? (
          <SettingsButton variant="ghost" onClick={flow.back}>
            {t("common.back")}
          </SettingsButton>
        ) : undefined
      }
      actions={
        /* Cancel never stops an install, so while one runs the way out says what it really does. */
        flow.running ? (
          <SettingsButton onClick={onClose}>{t("memory.setup.background")}</SettingsButton>
        ) : (
          <>
            <SettingsButton variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </SettingsButton>
            {primary && (
              <SettingsButton
                type={primary.submit ? "submit" : "button"}
                form={primary.submit ? flow.formId : undefined}
                disabled={primary.disabled}
                onClick={primary.onClick}
              >
                {primary.busy ? <Loader2 className="motion-safe:animate-spin" /> : primary.icon === "download" ? <Download /> : null}
                {primary.label}
              </SettingsButton>
            )}
          </>
        )
      }
    >
      {flow.body}
    </StepDialogContent>
  );
}
