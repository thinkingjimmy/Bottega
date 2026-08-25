/**
 * [INPUT]: Depends on React, Lucide, I18n, UI Popover, Shared, Authorization listing, Renderer security outlet and sibling FullAccessDialog
 * [OUTPUT]: Provides ChatPermissionSelector, which shows the current capability to drive permissions menu at the back end and confirms the risk of Codex Full Access
 * [POS]: The controller of the permissions is located in the chat/composer input box below the left; The documentation does not assume that the vendor has completed the risk disclosure of the renderer before the risk upgrade; The trigger is enclosed as a pure icon when @container/composer is narrower than 28rem or when the single-string (data-slot=permission-label) is left unlockedThe status identity is external to data-permission-mode listing rather than localized documentation, so e2e does not drift with language
 */

import { useState, type ComponentType } from "react";
import { Check, Hand, ShieldCheck, ShieldAlert } from "lucide-react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@ai-chat/ui/components/ui/popover";
import { cn } from "@ai-chat/ui/lib/utils";
import { openExternal } from "@/lib/agent-client";
import { errorMessage } from "@/lib/errors";
import type { AgentPermissionMode } from "../../../../shared/agent-ipc";
import { FullAccessDialog } from "./full-access-dialog";
import { acknowledgeFullAccess } from "@/lib/settings-client";

const LEARN_MORE = "https://learn.chatgpt.com/docs/sandboxing?surface=app#how-you-control-it";

/* 表里只留档位的**不变量**：枚举、字形、危险与否。文案按 value 查目录，
   于是「加一档」只需加一行，翻译由目录同构性把关，不会漏一处硬写。 */
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
  value,
  disabled,
  saving,
  onChange,
  allowedModes,
  backendDisplayName = "Agent",
}: {
  value: AgentPermissionMode;
  disabled?: boolean;
  saving?: boolean;
  onChange: (mode: AgentPermissionMode) => Promise<void>;
  allowedModes?: AgentPermissionMode[];
  backendDisplayName?: string;
}) {
  const { t } = useAppTranslation();
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const visibleOptions = allowedModes
    ? options.filter((option) => allowedModes.includes(option.value))
    : options;
  const selected =
    visibleOptions.find((option) => option.value === value) ??
    visibleOptions[0] ??
    options[0]!;
  const SelectedIcon = selected.icon;
  const modeLabel = (mode: AgentPermissionMode) =>
    t(`permission.mode.${mode}.label`);

  const choose = async (mode: AgentPermissionMode) => {
    if (mode === value) {
      setOpen(false);
      return;
    }
    if (mode === "full-access") {
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
      await acknowledgeFullAccess();
      await onChange("full-access");
      setConfirmOpen(false);
    } catch (cause) {
      setConfirmError(
        t("permission.fullAccess.failed", { reason: errorMessage(cause) })
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
            title={t("permission.trigger", { mode: modeLabel(selected.value) })}
            className={cn(
              "flex h-8 min-w-0 cursor-pointer items-center gap-1.5 rounded-full px-1.5 font-normal text-sm text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50",
              open && "bg-muted hover:bg-muted/80"
            )}
          >
            <SelectedIcon className="size-4 shrink-0" />
            {/* 栏宽不足 28rem 时文字整体退场：图标已经承载语义，让位给同排
                更长且不可替代的模型名。无障碍名称与 title 仍是完整档位。
                单行闲置态同理退场，见 chat-composer-inline.css。 */}
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
                onClick={() => void openExternal(LEARN_MORE)}
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
        open={confirmOpen}
        busy={confirming || Boolean(saving)}
        error={confirmError}
        onCancel={cancelFullAccess}
        onConfirm={() => void confirmFullAccess()}
        onLearnMore={() => void openExternal(LEARN_MORE)}
      />
    </>
  );
}
