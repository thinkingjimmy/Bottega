/**
 * [INPUT]: Depends on React, MemoryRuntimeSnapshot, shared/version-compare version order, i18n with Unified AppDialog/SettingsChoiceRow
 * [OUTPUT]: Provides MemoryVersionDialog: Named by the provider, a credible list of current yank missing Tabs, recent reverse-key installation, directory warning/error, return of visible focus after the backend task is closed, 44px operation and accurate confirmation
 * [POS]: The Settings › Memory version selects the complex pop-up window; Submit only directory members, not build installation commands
 */

import { type ComponentProps, useState } from "react";
import type { MemoryRuntimeSnapshot } from "../../../../shared/memory-ipc";
import { compareVersions } from "../../../../shared/version-compare";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { SettingsChoiceRow, SettingsList } from "@/components/settings/settings-layout";
import { AppDialogBody, AppDialogContent } from "@ai-chat/ui/components/ui/app-dialog";
import { Button } from "@ai-chat/ui/components/ui/button";
import { cn } from "@ai-chat/ui/lib/utils";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ai-chat/ui/components/ui/dialog";

export function MemoryVersionDialog({
  open,
  runtime,
  providerName,
  versions,
  busy,
  error,
  onOpenChange,
  onConfirm,
  onCloseAutoFocus,
}: {
  open: boolean;
  runtime: MemoryRuntimeSnapshot;
  /** 标题里点名的那个后端；两家运行时共用这一个弹窗，标题不许写死一家。 */
  providerName: string;
  versions: string[];
  busy: boolean;
  error?: string | null;
  onOpenChange(open: boolean): void;
  onConfirm(version: string): void;
  onCloseAutoFocus?: ComponentProps<typeof AppDialogContent>["onCloseAutoFocus"];
}) {
  const { t } = useAppTranslation();
  const title = t("memory.version.title", { provider: providerName });
  const [choice, setChoice] = useState<{
    installedVersion: string | null;
    value: string;
  } | null>(null);
  const installedChoice = runtime.installedVersion &&
    versions.includes(runtime.installedVersion)
    ? runtime.installedVersion
    : null;
  const selected = choice?.installedVersion === runtime.installedVersion &&
    versions.includes(choice.value)
    ? choice.value
    : installedChoice ?? versions[0] ?? "";
  const close = () => {
    setChoice(null);
    onOpenChange(false);
  };
  const downgrade = Boolean(
    selected &&
      runtime.installedVersion &&
      compareVersions(selected, runtime.installedVersion) < 0
  );
  const selectedYanked = runtime.yankedVersions?.includes(selected) ?? false;
  /* 最近安装：装错版本之后，回退的目标几乎总是「刚才那个」，而它此刻
     埋在一份几十行的目录里。历史本身是新到旧的，这里只做两次过滤——
     当前版本不是回退目标，目录里已经没有的版本不是可走的路：一个点不
     动的按钮比没有这个按钮更糟。 */
  const rollback = runtime.versionHistory
    .filter(
      (version) =>
        version !== runtime.installedVersion && versions.includes(version)
    )
    .slice(0, 5);
  return (
    <Dialog open={open} onOpenChange={(next) => next ? onOpenChange(true) : close()}>
      <AppDialogContent
        showCloseButton
        aria-busy={busy}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t("memory.version.description")}</DialogDescription>
        </DialogHeader>
        <AppDialogBody className="space-y-3">
          {rollback.length > 0 && (
            <div data-testid="memory-version-history" className="space-y-1.5">
              <p className="font-medium text-sm">
                {t("memory.version.historyTitle")}
              </p>
              <p className="text-muted-foreground text-xs leading-relaxed">
                {t("memory.version.historyHint")}
              </p>
              <div className="flex flex-wrap gap-2">
                {rollback.map((version) => (
                  <button
                    key={version}
                    type="button"
                    disabled={busy}
                    aria-pressed={selected === version}
                    className={cn(
                      "min-h-11 touch-manipulation rounded-full px-3 text-xs tabular-nums ring-1 ring-foreground/10",
                      "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                      "disabled:opacity-50",
                      selected === version && "bg-muted font-medium"
                    )}
                    onClick={() =>
                      setChoice({
                        installedVersion: runtime.installedVersion,
                        value: version,
                      })
                    }
                  >
                    {version}
                  </button>
                ))}
              </div>
            </div>
          )}
          <SettingsList role="radiogroup" aria-label={title}>
            {versions.map((version) => {
              const badges = [
                version === runtime.installedVersion ? t("memory.version.current") : "",
                version === runtime.lockedVersion ? t("memory.version.locked") : "",
                version === runtime.latestVersion ? t("memory.version.latest") : "",
                runtime.yankedVersions?.includes(version) ? t("memory.version.yanked") : "",
              ].filter(Boolean).join(" · ");
              return (
                <SettingsChoiceRow
                  key={version}
                  label={version}
                  description={badges || t("memory.version.selectable")}
                  checked={selected === version}
                  disabled={busy || (
                    runtime.yankedVersions?.includes(version) &&
                    version !== runtime.installedVersion
                  )}
                  onSelect={() => setChoice({
                    installedVersion: runtime.installedVersion,
                    value: version,
                  })}
                />
              );
            })}
          </SettingsList>
          {runtime.installedVersion && runtime.yankedVersions?.includes(runtime.installedVersion) && (
            <p role="alert" className="rounded-md bg-amber-500/10 px-3 py-2 text-amber-700 text-xs dark:text-amber-400">
              {t("memory.version.currentYanked", { version: runtime.installedVersion })}
            </p>
          )}
          {(downgrade || selectedYanked) && (
            <p role="alert" className="rounded-md bg-amber-500/10 px-3 py-2 text-amber-700 text-xs dark:text-amber-400">
              {downgrade ? t("memory.version.downgradeWarning") : t("memory.version.yankedWarning")}
            </p>
          )}
          {runtime.latestCheckError && (
            <p role="alert" className="rounded-md bg-amber-500/10 px-3 py-2 text-amber-700 text-xs dark:text-amber-400">
              {t("memory.version.catalogStaleWarning")}
            </p>
          )}
          {runtime.latestCheckWarning && (
            <p role="status" className="rounded-md bg-amber-500/10 px-3 py-2 text-amber-700 text-xs dark:text-amber-400">
              {t("memory.version.catalogValidationWarning")}
            </p>
          )}
          {selected && selected !== runtime.lockedVersion && (
            <p className="text-muted-foreground text-xs leading-relaxed">
              {t("memory.version.unverifiedWarning")}
            </p>
          )}
          {error && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-xs">
              {error}
            </p>
          )}
          {busy && (
            <p role="status" className="text-muted-foreground text-xs leading-relaxed">
              {t("memory.version.runningInBackground")}
            </p>
          )}
        </AppDialogBody>
        <DialogFooter>
          <Button size="pill" variant="outline" onClick={close}>
            {busy ? t("common.close") : t("common.cancel")}
          </Button>
          <Button
            size="pill"
            disabled={!selected || busy || selectedYanked || selected === runtime.installedVersion}
            onClick={() => {
              onConfirm(selected);
            }}
          >
            {t("memory.version.confirm", { version: selected })}
          </Button>
        </DialogFooter>
      </AppDialogContent>
    </Dialog>
  );
}
