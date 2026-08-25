/**
 * [INPUT]: Depends on React Focus, Lucide icon, I18n and share the original AppDialogContent/Dialog/Button
 * [OUTPUT]: Provides FullAccessDialog, which presents Full Access risk disclosure, out-of-chain, cancellation and confirmation status
 * [POS]: The chat/composer's risk authorization confirmation view; Responsible only for access to visual interaction, not perpetuation
 */

import { useRef, type ComponentType } from "react";
import {
  Folder,
  Globe2,
  SquareTerminal,
  TriangleAlert,
} from "lucide-react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  AppDialogBody,
  AppDialogContent,
} from "@ai-chat/ui/components/ui/app-dialog";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ai-chat/ui/components/ui/dialog";
import { cn } from "@ai-chat/ui/lib/utils";

/* 表里只留视觉不变量，标题与描述按 id 查目录：披露文案要随语言走，
   而图标与配色是这三条能力的身份，两者本就不该住在同一格。 */
const capabilities: Array<{
  id: "files" | "terminal" | "internet";
  icon: ComponentType<{ className?: string }>;
  iconClassName: string;
}> = [
  {
    id: "files",
    icon: Folder,
    iconClassName: "fill-sky-400 text-sky-500",
  },
  {
    id: "terminal",
    icon: SquareTerminal,
    iconClassName:
      "fill-none rounded-[0.2rem] bg-zinc-600 p-0.5 text-white [&_path]:stroke-[2.25] [&_rect]:stroke-transparent dark:bg-zinc-500",
  },
  {
    id: "internet",
    icon: Globe2,
    iconClassName: "text-cyan-400",
  },
];

export function FullAccessDialog({
  open,
  busy,
  error,
  onCancel,
  onConfirm,
  onLearnMore,
}: {
  open: boolean;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
  onLearnMore: () => void;
}) {
  const { t } = useAppTranslation();
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
    >
      <AppDialogContent
        aria-busy={busy}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelRef.current?.focus();
        }}
      >
        <DialogHeader className="shrink-0 gap-0 text-left">
          <DialogTitle className="flex items-center gap-2.5 text-xl/7 font-semibold">
            <TriangleAlert className="size-5 shrink-0 stroke-[1.75]" />
            {t("permission.fullAccess.title")}
          </DialogTitle>
          <DialogDescription className="mt-3.5 text-[15px]/[1.4] text-muted-foreground">
            {t("permission.fullAccess.description")}
          </DialogDescription>
        </DialogHeader>

        <AppDialogBody>
        <div className="mt-3.5 rounded-[1.1rem] bg-muted/75 px-4 py-1">
          {capabilities.map((capability, index) => {
            const Icon = capability.icon;
            return (
              <div
                key={capability.id}
                className={cn(
                  "flex min-h-[3.3rem] items-center gap-3.5",
                  index < capabilities.length - 1 &&
                    "border-b border-border/80"
                )}
              >
                <Icon
                  className={cn(
                    "size-5 shrink-0 stroke-[1.75]",
                    capability.iconClassName
                  )}
                />
                <div className="min-w-0 py-1.5">
                  <p className="text-sm/5 font-semibold">
                    {t(`permission.fullAccess.${capability.id}.title`)}
                  </p>
                  <p className="text-[13px]/[1.35] text-muted-foreground">
                    {t(`permission.fullAccess.${capability.id}.description`)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-3.5 text-[15px]/[1.4] text-muted-foreground">
          {t("permission.fullAccess.risk")}{" "}
          <button
            type="button"
            className="cursor-pointer text-blue-500 outline-none hover:text-blue-600 focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-blue-500/40 dark:text-blue-400 dark:hover:text-blue-300"
            onClick={onLearnMore}
          >
            {t("permission.learnMore")}
          </button>
        </p>

        {error && (
          <p className="mt-2 text-xs/relaxed text-destructive" role="alert">
            {error}
          </p>
        )}
        </AppDialogBody>

        <DialogFooter className="mt-3.5 shrink-0 flex-row justify-end gap-3">
          <Button
            ref={cancelRef}
            type="button"
            variant="secondary"
            disabled={busy}
            className="h-9 min-w-22 cursor-pointer rounded-full px-5 text-sm font-normal disabled:cursor-not-allowed"
            onClick={onCancel}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            className="h-9 min-w-28 cursor-pointer rounded-full border-destructive/15 px-5 text-sm font-normal disabled:cursor-not-allowed"
            onClick={onConfirm}
          >
            <TriangleAlert className="size-4 stroke-[1.75]" />
            {t(
              busy
                ? "permission.fullAccess.confirming"
                : "permission.fullAccess.confirm"
            )}
          </Button>
        </DialogFooter>
      </AppDialogContent>
    </Dialog>
  );
}
