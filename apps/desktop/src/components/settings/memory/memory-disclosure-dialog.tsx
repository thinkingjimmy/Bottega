/**
 * [INPUT]: Depends on ConfirmationDialog, cn class name merged with main returns unofficial Consent preview
 * [OUTPUT]: Provides enable/cutover/sharing shared confirmation, four-tiered: this change → What to send/Where to send a single-line destination card) / Who can recall → The only option is History) → System boundary rules
 * [POS]: Consent Epoch for setting/memoryEach confirmation binds the instance to the preview digest, and does not preserve the permanent disclosure status
 */

import type {
  MemoryConsentPreview,
  MemoryConsentReason,
} from "../../../../shared/memory-ipc";
import type { MemorySharingMode } from "../../../../shared/settings-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { intlLocale } from "@/lib/i18n-locale";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import { cn } from "@ai-chat/ui/lib/utils";

export function MemoryDisclosureDialog({
  open,
  onOpenChange,
  onAccept,
  preview,
  includeHistory,
  onIncludeHistoryChange,
  busy,
  error,
  reason,
  historyDisabled,
  providerName,
  previousProviderName,
}: {
  open: boolean;
  onOpenChange(next: boolean): void;
  onAccept(): void;
  preview: MemoryConsentPreview | null;
  includeHistory: boolean;
  onIncludeHistoryChange(next: boolean): void;
  busy: boolean;
  error: string;
  reason: Exclude<MemoryConsentReason, "rebuild">;
  historyDisabled?: boolean;
  providerName: string;
  previousProviderName?: string;
}) {
  const { t } = useAppTranslation();
  const modeLabel = (mode: MemorySharingMode | null | undefined) =>
    mode ? t(`memory.sharing.mode.${mode}`) : "—";
  const scope = includeHistory
    ? t("memory.disclosure.scopeHistory", {
        chats: preview?.chats ?? 0,
        turns: preview?.turns ?? 0,
      })
    : t("memory.disclosure.scopeNew");
  /* 秒级精度在授权决策里没有任何意义，只会把日期撑成两行占满卡片。 */
  const stamp = (value: number) =>
    new Date(value).toLocaleString(intlLocale(), {
      dateStyle: "short",
      timeStyle: "short",
    });
  const historyRange =
    includeHistory && preview?.from && preview.to
      ? t("memory.disclosure.historyRange", {
          from: stamp(preview.from),
          to: stamp(preview.to),
        })
      : null;
  const gaps = includeHistory ? preview?.gaps ?? 0 : 0;
  /* 目的地只有一种表达：一行 host/model。cutover 多出来的旧目的地不是另
     一个分支，只是这一行里可能不存在的前半截——让它从 filter 里自然消失，
     而不是再写一个「有没有 previousHostname」的条件块。 */
  const destination = preview
    ? [
        preview.previousHostname &&
          `${preview.previousHostname}/${preview.previousModel ?? "—"}`,
        `${preview.hostname}/${preview.model}`,
      ]
        .filter(Boolean)
        .join(" → ")
    : t("memory.disclosure.readingDestination");
  const historyLocked = busy || historyDisabled;
  return (
    <ConfirmationDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        reason === "sharing"
          ? t("memory.sharing.dialogTitle")
          : previousProviderName
          ? t("memory.disclosure.switchTitle")
          : t("memory.disclosure.enableTitle")
      }
      busy={busy}
      confirmDisabled={!preview}
      description={
        <span className="space-y-3">
          {/* ── 这次改变了什么 ───────────────────────────────────── */}
          {previousProviderName && (
            <span className="block font-medium text-foreground">
              {previousProviderName} → {providerName}
            </span>
          )}
          {reason === "sharing" && (
            <span className="block font-medium text-foreground">
              {modeLabel(preview?.currentSharingMode)} →{" "}
              {modeLabel(preview?.nextSharingMode)}
            </span>
          )}

          {/* ── 发什么 / 发到哪 / 谁能召回 ───────────────────────── */}
          <span className="block">{t("memory.disclosure.processing")}</span>

          <span className="block rounded-xl border border-foreground/10 px-3 py-2.5">
            <span className="block text-xs">
              {t("memory.disclosure.destination")}
            </span>
            <span className="mt-1 block break-all font-mono text-xs text-foreground">
              {destination}
            </span>
          </span>

          <span className="block">
            {preview
              ? t(`memory.sharing.isolation.${preview.nextSharingMode}`)
              : t("memory.sharing.readingScope")}
          </span>
          {reason === "sharing" && (
            <span className="block">{t("memory.sharing.oldScopeRetained")}</span>
          )}
          {previousProviderName && (
            <span className="block">{t("memory.disclosure.switchBack")}</span>
          )}

          {/* ── 唯一的选择：带不带历史 ───────────────────────────── */}
          <span className="block rounded-xl border border-foreground/10 px-3 py-2.5">
            {/* items-center 而非 items-start：单行标签下 items-start 会把
                方框顶到 21px 行盒的顶部，视觉重心比文字高出一截。
                accent-foreground 让原生勾选框跟随前景色——系统蓝是这个
                黑白弹窗里唯一的高饱和点，会把注意力从主按钮上抢走。 */}
            <label
              className={cn(
                "flex items-center gap-2 text-foreground",
                historyLocked ? "cursor-not-allowed opacity-60" : "cursor-pointer"
              )}
            >
              <input
                type="checkbox"
                className="size-4 shrink-0 accent-foreground"
                checked={includeHistory}
                disabled={historyLocked}
                onChange={(event) => onIncludeHistoryChange(event.target.checked)}
              />
              <span>{t("memory.disclosure.includeHistory")}</span>
            </label>
            {/* pl-6 = 方框 1rem + gap 0.5rem：说明缩进到标签文字那条竖线上，
                否则它与方框左对齐，从属关系在视觉上是断的。 */}
            <span className="mt-1.5 block space-y-0.5 pl-6 text-xs">
              <span className="block">
                {t("memory.disclosure.scopePrefix", { scope })}
              </span>
              {historyRange && <span className="block">{historyRange}</span>}
              {historyDisabled && (
                <span className="block">{t("memory.sharing.historyPaused")}</span>
              )}
              {gaps > 0 && (
                <span className="block">
                  {t("memory.disclosure.gaps", { count: gaps })}
                </span>
              )}
            </span>
          </span>

          {/* ── 系统边界：读得到，但不与决策争夺注意力 ───────────── */}
          <span className="block space-y-1 text-xs">
            <span className="block">{t("memory.disclosure.thirdParty")}</span>
            <span className="block">{t("memory.disclosure.pauseBoundary")}</span>
            <span className="block">{t("memory.disclosure.atLeastOnce")}</span>
          </span>

          {error && (
            <span
              role="alert"
              className="block rounded-md bg-destructive/10 px-3 py-2 text-destructive"
            >
              {error}
            </span>
          )}
        </span>
      }
      confirmLabel={
        reason === "sharing"
          ? t("memory.sharing.confirm")
          : previousProviderName
          ? t("memory.disclosure.confirmSwitch")
          : t("memory.disclosure.confirmEnable")
      }
      cancelLabel={t("common.cancel")}
      onConfirm={onAccept}
    />
  );
}
