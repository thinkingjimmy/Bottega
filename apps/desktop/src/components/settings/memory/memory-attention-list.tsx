/**
 * [INPUT]: Depends on lucide AlertTriangle, shared MemoryAttentionItem/Action, settings-layout by SettingsButton, lib/memory-view by the tag table and time projection by @ai-chat/ui, cn by
 * [OUTPUT]: Provides MemoryAttentionList purely displayed components: hanging in a row: * disease tag + evidence + relative/absolute time + restore button group)
 * [POS]: The following is a list of the most commonly used methods for calculating the value of a data setJust throw the id on the user's choice of action and restore the semantics to the main
 */

import { AlertTriangle } from "lucide-react";
import type {
  MemoryAttentionAction,
  MemoryAttentionItem,
} from "../../../../shared/memory-ipc";
import { SettingsButton } from "@/components/settings/settings-layout";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { intlLocale } from "@/lib/i18n-locale";
import {
  TONE_SURFACE,
  TONE_TEXT,
  absoluteMoment,
  attentionActionLabel,
  attentionLabel,
  relativeMoment,
} from "@/lib/memory-view";
import { cn } from "@ai-chat/ui/lib/utils";

/* ============================================================
 * 每条挂起都自带恢复动作——「只展示不可操作」的挂起等于永久红点，
 * 不配存在（D14）。abandon 是唯一会丢事实的动作，故独占 destructive
 * 语气：同一排按钮里，能撤销的与不能撤销的必须一眼可辨。
 * ============================================================ */

export function MemoryAttentionList({
  items,
  now,
  onResolve,
}: {
  items: MemoryAttentionItem[];
  now: number;
  onResolve(id: string, action: MemoryAttentionAction): void;
}) {
  const { t } = useAppTranslation();
  const locale = intlLocale();
  const translate = (key: string, options?: Record<string, unknown>) =>
    t(key, options);
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div
          key={item.id}
          data-testid="memory-attention"
          className={cn("rounded-lg px-4 py-3.5 ring-1", TONE_SURFACE.warn)}
        >
          <p className="flex items-center gap-2 font-medium text-sm">
            <AlertTriangle className={cn("size-4 shrink-0", TONE_TEXT.warn)} />
            <span className="truncate">{attentionLabel(item.kind, translate)}</span>
          </p>
          <p
            className="mt-1 text-muted-foreground text-xs"
            title={absoluteMoment(item.at, locale)}
          >
            {item.detail} · {relativeMoment(item.at, now, locale, translate)}
            {item.sessionKey ? ` · ${item.sessionKey}` : ""}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {item.actions.map((action) => (
              <SettingsButton
                key={action}
                variant={action === "abandon" ? "ghost" : "outline"}
                className={
                  action === "abandon"
                    ? "text-destructive hover:bg-destructive/10 hover:text-destructive"
                    : undefined
                }
                onClick={() => onResolve(item.id, action)}
              >
                {attentionActionLabel(action, translate)}
              </SettingsButton>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
