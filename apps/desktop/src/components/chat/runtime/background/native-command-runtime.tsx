/**
 * [INPUT]: Uses durable original command parts, Chat/incarnation-scoped background IPC, complete permission-mode translation keys and the existing activity-row runtime context.
 * [OUTPUT]: Exports NativeCommandRuntimeProvider, attaching live output and Stop to original command details without adding layout.
 * [POS]: Native execution projection for existing transcript and subagent command rows; main keeps all authority.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SquareIcon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { ToolActivityProvider, type ToolActivityState } from "@ai-chat/ui/components/conversation/activity/runtime";
import type { ActivityTool } from "@ai-chat/ui/components/conversation/activity/groups";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import type { NativeBackgroundCommand } from "../../../../../shared/ipc/agent/background-ipc";

const EMPTY = { commands: [] as NativeBackgroundCommand[], recent: new Map<string, NativeBackgroundCommand>() };
const PERMISSION_MODE_KEYS = {
  "ask-for-approval": "chat.nativeBackground.modes.ask-for-approval",
  "approve-for-me": "chat.nativeBackground.modes.approve-for-me",
  "full-access": "chat.nativeBackground.modes.full-access",
} as const satisfies Record<NativeBackgroundCommand["permissionMode"], string>;

export function NativeCommandRuntimeProvider({ chatId, incarnationId, children }: { chatId?: string | null; incarnationId: string | null; children: ReactNode }) {
  const scope = JSON.stringify([chatId, incarnationId]);
  const { t } = useAppTranslation();
  const [snapshot, setSnapshot] = useState(() => ({ scope: "", ...EMPTY }));
  const { commands, recent } = snapshot.scope === scope ? snapshot : EMPTY;
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    if (!chatId || !incarnationId) return;
    let live = true, sequence = 0;
    const refresh = async () => {
      const request = ++sequence;
      try {
        const values = await window.agent?.listNativeBackground?.(chatId);
        if (!live || request !== sequence || !values) return;
        const owned = values.filter(command => command.chatId === chatId && command.incarnationId === incarnationId);
        setSnapshot(previous => {
          const recent = new Map(previous.scope === scope ? previous.recent : []);
          for (const command of owned) recent.set(command.itemId, command);
          while (recent.size > 64) recent.delete(recent.keys().next().value!);
          return { scope, commands: owned, recent };
        });
      } catch { /* The next owned change retries a failed read. */ }
    };
    refreshRef.current = refresh;
    const off = window.agent?.onNativeBackgroundChanged?.(id => { if (id === chatId) void refresh(); });
    void refresh();
    return () => { live = false; sequence++; off?.(); };
  }, [chatId, incarnationId, scope]);
  const stop = useCallback(async (command: NativeBackgroundCommand) => {
    if (commands.some(row => row.id === busy)) return;
    setBusy(command.id); setFailed(null);
    try {
      if (!window.agent?.stopNativeBackground) throw new Error("Native background control is unavailable");
      await window.agent.stopNativeBackground(command.chatId, command.incarnationId, command.id);
      await refreshRef.current();
    } catch { setFailed(command.id); }
    finally { setBusy(current => current === command.id ? null : current); }
  }, [busy, commands]);
  const resolve = useMemo(() => {
    const active = new Map(commands.map(command => [command.itemId, command]));
    return (part: ActivityTool): ToolActivityState | undefined => {
      if (part.tool !== "command") return;
      const command = active.get(part.itemId), snapshot = command ?? recent.get(part.itemId);
      if (!snapshot) return;
      return {
        status: command ? command.status === "failed" ? "failed" : "running" : part.status,
        detail: command ? [part.detail, snapshot.output].filter(Boolean).join("\n") : part.detail ?? "",
        actions: command && <Button type="button" size="sm" variant="ghost" data-native-command={part.itemId} onClick={() => void stop(command)} disabled={commands.some(row => row.id === busy) || command.status === "stopping"}>
          <SquareIcon className="size-3" />{busy === command.id || command.status === "stopping" ? t("chat.nativeBackground.stopping") : t("chat.nativeBackground.stop")}
        </Button>,
        description: command && <>
          <p className="px-3 pb-2 text-muted-foreground text-xs">{t("chat.nativeBackground.started", { mode: t(PERMISSION_MODE_KEYS[command.permissionMode]) })}</p>
          {(failed === command.id || command.status === "failed") && <p role="status" className="px-3 pb-2 text-destructive text-xs">{t("chat.nativeBackground.failed")}</p>}
        </>,
      };
    };
  }, [commands, recent, busy, failed, stop, t]);
  return <ToolActivityProvider value={resolve}>{children}</ToolActivityProvider>;
}
