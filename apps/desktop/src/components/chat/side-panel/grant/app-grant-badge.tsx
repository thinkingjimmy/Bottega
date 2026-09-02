"use client";

/**
 * [INPUT]: Depends on the App tab's effective grant projection, conversation incarnation fence, and shared AppAuthorizationDialog
 * [OUTPUT]: Provides AppGrantBadge as the App tab shield that opens the unified contextual authorization workflow
 * [POS]: Thin Chat-tab authorization trigger; it owns no permission form or durable mutation state
 */

import { useState } from "react";
import { Shield, ShieldOff } from "lucide-react";
import { cn } from "@ai-chat/ui/lib/utils";
import type { AvailableAttachedApp } from "../../../../../shared/apps-ipc";
import { AppAuthorizationDialog } from "@/components/apps/authorization/app-authorization-dialog";
import { useAppTranslation } from "@/components/providers/i18n-provider";

export function AppGrantBadge({
  app,
  chatId,
  incarnationId,
  onChanged,
  onRemoved,
}: {
  app: AvailableAttachedApp;
  chatId: string;
  incarnationId: string;
  onChanged: () => void | Promise<void>;
  onRemoved: () => void | Promise<void>;
}) {
  const { t } = useAppTranslation();
  const [open, setOpen] = useState(false);
  const disabled = !app.effectiveGrant;
  const Glyph = disabled ? ShieldOff : Shield;

  return (
    <>
      <button
        aria-label={t("chat.sidePanel.appGrant.badgeAria", {
          name: app.name,
          data: app.effectiveGrant?.data?.level ?? t("apps.authorization.dataNone"),
          delegation:
            app.effectiveGrant?.agentDelegation.fileRead ||
            app.effectiveGrant?.agentDelegation.useData
              ? t("chat.sidePanel.appGrant.on")
              : t("chat.sidePanel.appGrant.off"),
        })}
        className={cn(
          "grid size-[18px] shrink-0 cursor-pointer place-items-center rounded-sm outline-none transition-colors hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring/40",
          disabled ? "text-muted-foreground/50" : "text-muted-foreground"
        )}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        type="button"
      >
        <Glyph className="size-3.5" />
      </button>
      <AppAuthorizationDialog
        appId={app.appId}
        mode="edit"
        onCommitted={onChanged}
        onOpenChange={setOpen}
        onRemoved={onRemoved}
        open={open}
        target={{
          kind: "chat",
          chatId,
          expectedConversationIncarnationId: incarnationId,
        }}
      />
    </>
  );
}
