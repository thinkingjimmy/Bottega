/**
 * [INPUT]: Depends on the memory setup flow, shared Dialog/AppDialog primitives, the shared Button and i18n
 * [OUTPUT]: Provides MemorySetupDialog — the three-step memory setup inside the product's dialog: segment progress and caption at dialog scale, the flow's body, and pill actions (Back · Cancel/Hide · primary)
 * [POS]: Onboarding's way to set up memory without leaving step four; the Settings › Memory page draws the same flow as the open column instead
 */

import { useAppTranslation } from "@/components/providers/i18n-provider";
import { Button } from "@ai-chat/ui/components/ui/button";
import { AppDialogBody, AppDialogContent } from "@ai-chat/ui/components/ui/app-dialog";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ai-chat/ui/components/ui/dialog";
import { cn } from "@ai-chat/ui/lib/utils";
import { MemorySetupButton, useMemorySetupFlow, type MemorySetupProps } from "./memory-setup";

export function MemorySetupDialog({
  open,
  onOpenChange,
  ...props
}: { open: boolean; onOpenChange(next: boolean): void } & MemorySetupProps) {
  const { t } = useAppTranslation();
  const flow = useMemorySetupFlow(props);
  /* A running install has no primary action: closing then only hides the dialog, the install carries on. */
  const running = flow.step === 1 && flow.primary === null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AppDialogContent showCloseButton={false} data-memory-setup-dialog="">
        <ol className="flex gap-1.5">
          {flow.steps.map((label, index) => (
            <li
              key={label}
              aria-current={index === flow.step ? "step" : undefined}
              className={cn("h-[3px] min-w-0 flex-1 rounded-[2px]", index <= flow.step ? "bg-foreground" : "bg-border")}
            >
              <span className="sr-only">{label}</span>
            </li>
          ))}
        </ol>
        <p className="mt-2.5 text-muted-foreground text-xs/4">{flow.caption}</p>
        <DialogHeader className="mt-4 gap-0 text-left">
          <DialogTitle className="text-xl/7 font-semibold">{flow.title}</DialogTitle>
          <DialogDescription className="mt-3 text-[15px]/[1.4] text-muted-foreground">
            {flow.description}
          </DialogDescription>
        </DialogHeader>
        <AppDialogBody className="mt-5 flex flex-col gap-3">{flow.body}</AppDialogBody>
        <DialogFooter className="mt-5 sm:justify-end sm:gap-x-3">
          {flow.back && (
            <Button size="pill" variant="ghost" className="text-muted-foreground" onClick={flow.back}>
              {t("common.back")}
            </Button>
          )}
          <Button size="pill" variant="ghost" className="text-muted-foreground" onClick={() => onOpenChange(false)}>
            {running ? t("onboarding.memoryHide") : t("common.cancel")}
          </Button>
          {flow.primary && <MemorySetupButton action={flow.primary} formId={flow.formId} size="pill" />}
        </DialogFooter>
      </AppDialogContent>
    </Dialog>
  );
}
