/**
 * [INPUT]: Depends on React (useRef for focus), lucide icons, i18n, and shared AppDialogContent/Dialog/Button primitives
 * [OUTPUT]: Provides FullAccessDialog, which presents the Full Access risk disclosure with capability icons, a learn-more link, and cancel/confirm/busy/error states
 * [POS]: The chat/composer risk-confirmation dialog; it only renders the confirmation UI and holds no persistence state itself
 */

import { useRef, type ComponentType } from "react";
import {
  Folder,
  Globe2,
  SquareTerminal,
  TriangleAlert,
} from "lucide-react";
import { useComposerTranslation } from "./copy/translation";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  AppDialogBody,
  AppDialogCancel,
  AppDialogContent,
  AppDialogFooter,
  AppDialogHeader,
} from "@ai-chat/ui/components/ui/app-dialog";
import { Dialog } from "@ai-chat/ui/components/ui/dialog";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { cn } from "@ai-chat/ui/lib/utils";

/* Keep capability identity independent of the localized disclosure copy. */
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
  locale,
  scopeLabel,
  open,
  busy,
  error,
  onCancel,
  onConfirm,
  onLearnMore,
}: {
  locale: string;
  scopeLabel?: string;
  open: boolean;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
  onLearnMore: () => void;
}) {
  const t = useComposerTranslation(locale);
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
        <AppDialogHeader
          className="shrink-0"
          title={<span className="flex items-center gap-2.5">
            <TriangleAlert className="size-5 shrink-0 stroke-[1.75]" />
            {t("permission.fullAccess.title")}
          </span>}
          description={<>
            {scopeLabel && <span className="mb-2 block font-medium text-foreground">{scopeLabel}</span>}
            {t("permission.fullAccess.description")}
          </>}
        />

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

        <AppDialogFooter>
          <AppDialogCancel ref={cancelRef} disabled={busy} onClick={onCancel} />
          <Button
            type="button"
            variant="destructive"
            size="pill"
            disabled={busy}
            className="border-destructive/15"
            onClick={onConfirm}
          >
            {busy ? <Spinner /> : <TriangleAlert className="size-4 stroke-[1.75]" />}
            {t("permission.fullAccess.confirm")}
          </Button>
        </AppDialogFooter>
      </AppDialogContent>
    </Dialog>
  );
}
