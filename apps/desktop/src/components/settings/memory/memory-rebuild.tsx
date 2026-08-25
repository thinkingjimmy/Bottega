/**
 * [INPUT]: Depends on lucide RotateCcw, shared MemoryRebuildSnapshot, settings-layout SettingsButton, ui/ConfirmationDialog, lib/memory-view, and the color tables, @ai-chat/ui cn
 * [OUTPUT]: Provides MemoryRebuildButton, MemoryRebuildProgress, and independently acceptable MemoryRebuildDescription with MemoryRebuildDialog
 * [POS]: The three rebuilds of settings/memory; Input, progress and confirmation of the same source folders are three intersections of the same state machine.The finished mode is removed by the caller according to rebuildOutstanding, and the progress card is only for the time it is still running or it has been interrupted
 */

import { RotateCcw } from "lucide-react";
import type {
  MemoryConsentPreview,
  MemoryRebuildSnapshot,
} from "../../../../shared/memory-ipc";
import { SettingsButton } from "@/components/settings/settings-layout";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { rebuildPhaseLabel, TONE_TEXT } from "@/lib/memory-view";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import { cn } from "@ai-chat/ui/lib/utils";

/* ============================================================
 * 重建曾独占一个 section：一个标题、一句描述，供养一个按钮。而它
 * 清空并重算的，恰好就是「运行观测」里那几个数字——动作理应待在
 * 它所作用的那片事实的段头上，而不是隔着半页另立门户。
 *
 * 入口与进度也就此挨在一起：按住不放的那一刻起，同一位置由按钮
 * 变成进度，用户的视线不必迁移。
 * ============================================================ */

export function MemoryRebuildButton({
  running,
  onClick,
}: {
  running: boolean;
  onClick(): void;
}) {
  const { t } = useAppTranslation();
  return (
    <SettingsButton variant="outline" disabled={running} onClick={onClick}>
      <RotateCcw />
      {t("memory.rebuild.button")}
    </SettingsButton>
  );
}

export function MemoryRebuildProgress({
  rebuild,
}: {
  rebuild: MemoryRebuildSnapshot;
}) {
  const { t } = useAppTranslation();
  const translate = (key: string, options?: Record<string, unknown>) =>
    t(key, options);
  return (
    <div
      data-testid="memory-rebuild"
      className="rounded-lg bg-card px-4 py-3.5 text-xs ring-1 ring-foreground/10"
    >
      <p className="font-medium text-sm">
        {rebuildPhaseLabel(rebuild.phase, translate)}
      </p>
      {rebuild.phase !== "completed" && rebuild.phase !== "failed" && (
        <p className="mt-1 text-muted-foreground">
          {t("memory.rebuild.unavailable")}
        </p>
      )}
      <p className="mt-1 text-muted-foreground">
        {t("memory.rebuild.progress", {
          purged: rebuild.purgedScopes,
          totalScopes: rebuild.totalScopes,
          backfilledTurns: rebuild.backfilledTurns,
          totalTurns: rebuild.totalTurns,
        })}
      </p>
      {rebuild.error && (
        <p className={cn("mt-1", TONE_TEXT.danger)}>{rebuild.error}</p>
      )}
      <p className="mt-1 text-muted-foreground">
        {t("memory.rebuild.intentStable")}
      </p>
    </div>
  );
}

export function MemoryRebuildDialog({
  open,
  onOpenChange,
  providerName,
  preview,
  paused,
  resetsManagedConfig,
  onConfirm,
}: {
  open: boolean;
  onOpenChange(next: boolean): void;
  providerName: string;
  preview: MemoryConsentPreview | null;
  paused: boolean;
  resetsManagedConfig: boolean;
  onConfirm(): void;
}) {
  const { t } = useAppTranslation();
  return (
    <ConfirmationDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("memory.rebuild.title")}
      description={
        <MemoryRebuildDescription
          providerName={providerName}
          preview={preview}
          paused={paused}
          resetsManagedConfig={resetsManagedConfig}
        />
      }
      confirmLabel={t("memory.rebuild.confirm")}
      confirmDisabled={!preview}
      onConfirm={onConfirm}
    />
  );
}

export function MemoryRebuildDescription({
  providerName,
  preview,
  paused,
  resetsManagedConfig,
}: {
  providerName: string;
  preview: MemoryConsentPreview | null;
  paused: boolean;
  resetsManagedConfig: boolean;
}) {
  const { t } = useAppTranslation();
  return (
    <span className="space-y-3">
      <span className="block">
        {t("memory.rebuild.description", { provider: providerName })}
      </span>
      <span className="block">
        {t("memory.rebuild.scope", {
          chats: preview?.chats ?? "—",
          turns: preview?.turns ?? "—",
          hostname: preview?.hostname ?? t("memory.common.unread"),
          model: preview?.model ?? t("memory.common.unread"),
        })}
      </span>
      <span className="block">
        {t("memory.rebuild.pauseIntent", {
          intent: paused
            ? t("memory.common.paused")
            : t("memory.common.enabled"),
        })}
      </span>
      <span className="block">
        {t("memory.rebuild.trimmed")}
      </span>
      {resetsManagedConfig && (
        <span className="block">
          {t("memory.rebuild.resetManualConfig")}
        </span>
      )}
    </span>
  );
}
