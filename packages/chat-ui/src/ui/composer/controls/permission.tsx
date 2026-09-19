/**
 * [INPUT]: React, shared UI primitives, five-language composer copy and capability-filtered permission modes.
 * [OUTPUT]: Permission selection with native acknowledgment or deferred session-scoped confirmation; the chip flags a mode the current Agent does not allow.
 * [POS]: Shared desktop and Web permission control; hosts supply authority and external navigation adapters.
 */

import { useState, type ComponentType } from "react";
import { Check, Hand, ShieldCheck, ShieldAlert, TriangleAlert } from "lucide-react";
import { useComposerTranslation } from "./copy/translation";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@ai-chat/ui/components/ui/popover";
import { cn } from "@ai-chat/ui/lib/utils";


import type { RemotePermissionMode as AgentPermissionMode } from "@ai-chat/cloud-protocol/remote/input/model";
import { FullAccessDialog } from "./full-access";


const LEARN_MORE = "https://learn.chatgpt.com/docs/sandboxing?surface=app#how-you-control-it";

/* Mode identity and icons stay fixed while labels come from the shared locale catalog. */
const options: Array<{
  value: AgentPermissionMode;
  icon: ComponentType<{ className?: string }>;
  danger?: boolean;
}> = [
  { value: "ask-for-approval", icon: Hand },
  { value: "approve-for-me", icon: ShieldCheck },
  { value: "full-access", icon: ShieldAlert, danger: true },
];

export function ChatPermissionSelector({
  locale,
  acknowledgeFullAccess,
  openExternal,
  deferConfirmation = false,
  value,
  disabled,
  saving,
  onChange,
  allowedModes,
  backendDisplayName = "Agent",
  unavailableTitle,
}: {
  locale: string;
  acknowledgeFullAccess?(): Promise<unknown>;
  openExternal?(url: string): unknown;
  deferConfirmation?: boolean;
  value: AgentPermissionMode;
  disabled?: boolean;
  saving?: boolean;
  onChange: (mode: AgentPermissionMode) => Promise<void>;
  allowedModes?: AgentPermissionMode[];
  backendDisplayName?: string;
  /** Shown when the current mode is not among the allowed ones: the chip flags itself and the popover offers the way out. */
  unavailableTitle?: string;
}) {
  const t = useComposerTranslation(locale);
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const visibleOptions = allowedModes
    ? options.filter((option) => allowedModes.includes(option.value))
    : options;
  const selected =
    options.find((option) => option.value === value) ?? options[0]!;
  const unavailable = Boolean(allowedModes && !allowedModes.includes(selected.value));
  const SelectedIcon = unavailable ? TriangleAlert : selected.icon;
  const modeLabel = (mode: AgentPermissionMode) =>
    t(`permission.mode.${mode}.label`);

  const choose = async (mode: AgentPermissionMode) => {
    if (mode === value) {
      setOpen(false);
      return;
    }
    if (mode === "full-access" && !deferConfirmation) {
      setOpen(false);
      setConfirmError("");
      setConfirmOpen(true);
      return;
    }
    await onChange(mode);
    setOpen(false);
  };

  const cancelFullAccess = () => {
    if (confirming || saving) return;
    setConfirmOpen(false);
    setConfirmError("");
  };

  const confirmFullAccess = async () => {
    if (confirming || saving) return;
    setConfirming(true);
    setConfirmError("");
    try {
      await acknowledgeFullAccess?.();
      await onChange("full-access");
      setConfirmOpen(false);
    } catch (cause) {
      setConfirmError(
        t("permission.fullAccess.failed", { reason: cause instanceof Error ? cause.message : String(cause) })
      );
    } finally {
      setConfirming(false);
    }
  };

  return (
    <>
      <Popover open={open} onOpenChange={(next) => !disabled && !saving && setOpen(next)}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled || saving}
            data-permission-mode={selected.value}
            aria-label={t("permission.trigger", {
              mode: modeLabel(selected.value),
            })}
            title={unavailable && unavailableTitle ? unavailableTitle : t("permission.trigger", { mode: modeLabel(selected.value) })}
            data-permission-unavailable={unavailable || undefined}
            className={cn(
              "flex h-8 min-w-0 cursor-pointer items-center gap-1.5 rounded-full px-1.5 font-normal text-sm text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50",
              unavailable && "text-foreground",
              open && "bg-muted hover:bg-muted/80"
            )}
          >
            <SelectedIcon className={cn("size-4 shrink-0", unavailable && "text-destructive")} />
            {/* Narrow composers retain the complete accessible name while showing only the icon. */}
            <span
              className="truncate @max-md/composer:hidden"
              data-slot="permission-label"
            >
              {modeLabel(selected.value)}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          className="w-max max-w-[calc(100vw-2rem)] rounded-2xl p-3 font-normal [&_svg]:[stroke-width:1.5]"
        >
          <div className="flex items-center justify-between gap-4 px-2 pb-2 text-sm text-muted-foreground">
            <span>
              {t("permission.heading", { backend: backendDisplayName })}
            </span>
            {visibleOptions.some((option) => option.value === "full-access") && (
              <button
                type="button"
                className="shrink-0 underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                onClick={() => void (openExternal ?? ((url: string) => window.open(url, "_blank", "noopener,noreferrer")))(LEARN_MORE)}
              >
                {t("permission.learnMore")}
              </button>
            )}
          </div>
          <div className="space-y-px">
            {visibleOptions.map((option) => {
              const Icon = option.icon;
              const active = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={disabled || saving}
                  data-permission-mode={option.value}
                  onClick={() => void choose(option.value)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-2 py-1 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40",
                    option.danger && "text-orange-600 dark:text-orange-500"
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-normal">
                      {modeLabel(option.value)}
                    </span>
                    <span className={cn("block text-xs", option.danger ? "text-current" : "text-muted-foreground")}>
                      {t(`permission.mode.${option.value}.description`)}
                    </span>
                  </span>
                  <span className="size-4 shrink-0">
                    {active && (
                      <Check
                        className="size-4"
                        aria-label={t("permission.selected")}
                      />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
      <FullAccessDialog
        locale={locale}
        open={confirmOpen}
        busy={confirming || Boolean(saving)}
        error={confirmError}
        onCancel={cancelFullAccess}
        onConfirm={() => void confirmFullAccess()}
        onLearnMore={() => void (openExternal ?? ((url: string) => window.open(url, "_blank", "noopener,noreferrer")))(LEARN_MORE)}
      />
    </>
  );
}
