/**
 * [INPUT]: Depends on React, lucide Loader2, the shared MemoryConfigPanel contract, i18n, and Dialog/Input/Button/ConfirmationDialog from @ai-chat/ui
 * [OUTPUT]: Provides blankMemoryConfigValues, MemoryConfigFields (the one secret form, shared with the setup wizard), MemoryRuntimeConfigDialog and MemoryUninstallDialog
 * [POS]: The two dialogs of the settings/memory engine drawer and their shared field form; the drawer body belongs to memory-runtime-panel and the open state to the view
 */

import { Loader2 } from "lucide-react";
import type { MemoryConfigPanel } from "../../../../shared/memory-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  AppDialogBody,
  AppDialogContent,
  ConfirmationDialog,
} from "@ai-chat/ui/components/ui/app-dialog";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ai-chat/ui/components/ui/dialog";
import { Input } from "@ai-chat/ui/components/ui/input";
import { cn } from "@ai-chat/ui/lib/utils";

export const blankMemoryConfigValues = (panel: MemoryConfigPanel | null) =>
  Object.fromEntries((panel?.fields ?? []).map((field) => [field.key, ""]));

/* ============================================================
 * 配置字段：密钥表单只有这一份实现。
 *
 * 它同时长在两处——设置里的配置弹窗，与初次设置的第三步。两处各写
 * 一遍意味着 secret/autocomplete/1Password 抑制/「留空即保留」这些
 * 与凭据安全相关的细节会各自漂移，而漂移的那一份不会有人发现。
 * 表单的形状归这里，容器（弹窗还是页面）归调用方。
 * ============================================================ */

export function MemoryConfigFields({
  panel,
  values,
  busy,
  requireMissingValues,
  autoFocusFirst,
  onChange,
}: {
  panel: MemoryConfigPanel;
  values: Record<string, string>;
  busy: boolean;
  requireMissingValues: boolean;
  autoFocusFirst: boolean;
  onChange(values: Record<string, string>): void;
}) {
  const { t } = useAppTranslation();
  return (
    <>
      {panel.fields.map((field, index) => {
        const inputId = `memory-config-${panel.panelId}-${field.key}`;
        const descriptionId = `${inputId}-description`;
        /* 占位文案有两种身份：「留空即保留」是一句话，示例值是一个值。
           句子该走界面字体——等宽把中文一个字一个字撑开，读起来像被
           拆散的密码；示例值该走等宽——用户照着它的形状填，字符必须
           一眼可辨。同一个条件决定文案与字体，不留第二处判断。 */
        const retainHint = field.retainedWhenBlank;
        return (
          <div key={field.key} className="space-y-1.5">
            <label htmlFor={inputId} className="block font-medium text-sm">
              {t(`memory.provider.${panel.providerId}.field.${field.key}.label`, {
                defaultValue: field.label,
              })}
            </label>
            <Input
              id={inputId}
              name={field.key}
              type={field.secret ? "password" : "text"}
              autoFocus={index === 0 && autoFocusFirst}
              autoComplete={field.secret ? "new-password" : "off"}
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore
              required={requireMissingValues && field.required}
              aria-describedby={descriptionId}
              placeholder={
                retainHint
                  ? t("memory.runtime.retainBlank")
                  : field.defaultValue ?? ""
              }
              value={values[field.key] ?? ""}
              disabled={busy}
              onChange={(event) =>
                onChange({ ...values, [field.key]: event.target.value })
              }
              /* 14px 是这里的正确刻度：比基线的 12px 大一档，因为密钥与
                 URL 要逐字符核对；也不到 16px——那是移动端防缩放的规矩，
                 搬到桌面只会让输入值压过它自己的标签。md: 必须显式写，
                 否则基线的 md:text-xs 会在桌面断点上赢回去。 */
              className={cn(
                "h-9 w-full px-3 font-mono text-sm md:text-sm",
                retainHint && "placeholder:font-sans"
              )}
            />
            <p
              id={descriptionId}
              className="text-muted-foreground text-xs leading-relaxed"
            >
              {t(
                `memory.provider.${panel.providerId}.field.${field.key}.description`,
                { defaultValue: field.description }
              )}
            </p>
          </div>
        );
      })}
    </>
  );
}

export function MemoryRuntimeConfigDialog({
  open,
  panel,
  values,
  busy,
  error,
  requireMissingValues,
  onOpenChange,
  onChange,
  onSubmit,
}: {
  open: boolean;
  panel: MemoryConfigPanel;
  values: Record<string, string>;
  busy: boolean;
  error: string;
  requireMissingValues: boolean;
  onOpenChange(next: boolean): void;
  onChange(values: Record<string, string>): void;
  onSubmit(): void;
}) {
  const { t } = useAppTranslation();
  const allowAutoFocus =
    typeof window === "undefined" || !("ontouchstart" in window);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <AppDialogContent
        showCloseButton={false}
        aria-busy={busy}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <DialogHeader className="shrink-0 gap-0 text-left">
            <DialogTitle className="font-semibold text-xl/7">
              {t("memory.runtime.configDialogTitle", {
                provider: panel.title,
              })}
            </DialogTitle>
            {/* 说明跟着密钥走：这句「只保存在本机」从前印在设置页上一块
                常驻区里，而人是在这张表单里交出密钥的。承诺要待在动手的
                那一刻，且各家运行时的保管方式本就不同（0600 ov.conf 与
                LaunchAgent），descriptor 自带的那句比一句通用文案更准。 */}
            <DialogDescription className="mt-2 text-[15px]/[1.4]">
              {t(`memory.provider.${panel.providerId}.panel.description`, {
                defaultValue: panel.description,
              })}
            </DialogDescription>
          </DialogHeader>

          <AppDialogBody className="mt-4 space-y-4 pr-1">
            <MemoryConfigFields
              panel={panel}
              values={values}
              busy={busy}
              requireMissingValues={requireMissingValues}
              autoFocusFirst={allowAutoFocus}
              onChange={onChange}
            />
            {error && (
              <p
                role="alert"
                className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-xs ring-1 ring-destructive/20"
              >
                {error}
              </p>
            )}
            <p className="text-muted-foreground text-xs">
              {t("memory.runtime.draftRetained")}
            </p>
          </AppDialogBody>

          <DialogFooter className="mt-4 shrink-0 flex-row justify-end gap-3">
            <Button
              type="button"
              variant="ghost"
              size="pill"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              size="pill"
              disabled={busy}
              className="min-w-[7rem]"
            >
              {busy && <Loader2 className="motion-safe:animate-spin" />}
              {busy
                ? t("memory.runtime.savingConfig")
                : t("memory.runtime.submitRestart")}
            </Button>
          </DialogFooter>
        </form>
      </AppDialogContent>
    </Dialog>
  );
}

/* 卸载确认：入口按钮在版本行的图标排里，对话框由视图持有 open 态。文案必须把三件事说满：删什么
   （运行时 + 其中全部记忆数据）、留什么（授权账本与聊天）、然后会
   发生什么（该后端在用则自动关闭；重装后可重建回灌）。 */
export function MemoryUninstallDialog({
  open,
  onOpenChange,
  providerName,
  onConfirm,
}: {
  open: boolean;
  onOpenChange(next: boolean): void;
  providerName: string;
  onConfirm(): void;
}) {
  const { t } = useAppTranslation();
  return (
    <ConfirmationDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("memory.runtime.uninstallTitle", { provider: providerName })}
      description={
        <span className="space-y-3">
          <span className="block">
            {t("memory.runtime.uninstallDescription")}
          </span>
          <span className="block">
            {t("memory.runtime.uninstallRetention")}
          </span>
        </span>
      }
      confirmLabel={t("memory.runtime.uninstallConfirm")}
      confirmTone="destructive"
      onConfirm={onConfirm}
    />
  );
}
