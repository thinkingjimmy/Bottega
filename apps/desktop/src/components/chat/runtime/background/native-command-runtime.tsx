/**
 * [INPUT]: Uses durable original command parts, Chat/incarnation-scoped background IPC, complete permission-mode translation keys and the existing activity-row runtime context.
 * [OUTPUT]: Exports NativeCommandRuntimeProvider and useNativeCommands, sharing exact-item controls and live original-command output.
 * [POS]: Chat-scoped execution state shared by the composer service bar and transcript; main keeps all authority.
 */
import { createContext, useContext, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ToolActivityProvider, type ToolActivityState } from "@ai-chat/ui/components/conversation/activity/runtime";
import type { ActivityTool } from "@ai-chat/ui/components/conversation/activity/groups";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import type { NativeBackgroundCommand } from "../../../../../shared/ipc/agent/background-ipc";

const EMPTY = { commands: [] as NativeBackgroundCommand[], recent: new Map<string, NativeBackgroundCommand>() };
type CommandRuntime = { commands: NativeBackgroundCommand[]; stop(command: NativeBackgroundCommand): Promise<void> };
const NativeCommands = createContext<CommandRuntime>({ commands: [], stop: async () => {} });
export const useNativeCommands = () => useContext(NativeCommands);
const PERMISSION_MODE_KEYS = {
  "ask-for-approval": "chat.nativeBackground.modes.ask-for-approval",
  "approve-for-me": "chat.nativeBackground.modes.approve-for-me",
  "full-access": "chat.nativeBackground.modes.full-access",
} as const satisfies Record<NativeBackgroundCommand["permissionMode"], string>;

export function NativeCommandRuntimeProvider({ chatId, incarnationId, titles, children }: { chatId?: string | null; incarnationId: string | null; titles?: ReadonlyMap<string, string>; children: ReactNode }) {
  const scope = JSON.stringify([chatId, incarnationId]);
  const { t } = useAppTranslation();
  const [snapshot, setSnapshot] = useState(() => ({ scope: "", ...EMPTY }));
  const { commands, recent } = snapshot.scope === scope ? snapshot : EMPTY;
  const [controls, setControls] = useState({ scope, busy: new Set<string>(), failed: new Set<string>() });
  const pendingRef = useRef(new Set<string>());
  const currentScope = useRef(scope);
  useLayoutEffect(() => { currentScope.current = scope; }, [scope]);
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
    const key = JSON.stringify([scope, command.itemId]);
    if (currentScope.current !== scope || command.chatId !== chatId || command.incarnationId !== incarnationId || pendingRef.current.has(key)) return;
    pendingRef.current.add(key);
    const refresh = refreshRef.current;
    const update = (busy: boolean, failed: boolean) => setControls(previous => {
      if (currentScope.current !== scope) return previous;
      const next = { scope, busy: new Set(previous.scope === scope ? previous.busy : []), failed: new Set(previous.scope === scope ? previous.failed : []) };
      if (busy) next.busy.add(command.itemId); else next.busy.delete(command.itemId);
      if (failed) next.failed.add(command.itemId); else next.failed.delete(command.itemId);
      return next;
    });
    update(true, false);
    try {
      if (!window.agent?.stopNativeBackground) throw new Error("Native background control is unavailable");
      await window.agent.stopNativeBackground(command.chatId, command.incarnationId, command.id, command.itemId);
      await refresh(); update(false, false);
    } catch { await refresh(); update(false, true); }
    finally { pendingRef.current.delete(key); }
  }, [chatId, incarnationId, scope]);
  const runtime = useMemo<CommandRuntime>(() => ({ stop, commands: commands.map(command => ({ ...command,
    command: titles?.get(command.itemId) || command.command,
    status: controls.scope === scope && controls.busy.has(command.itemId) ? "stopping" : controls.scope === scope && controls.failed.has(command.itemId) ? "failed" : command.status,
  })) }), [commands, controls, scope, stop, titles]);
  const resolve = useMemo(() => {
    const active = new Map(commands.map(command => [command.itemId, command]));
    return (part: ActivityTool): ToolActivityState | undefined => {
      if (part.tool !== "command") return;
      const command = active.get(part.itemId), snapshot = command ?? recent.get(part.itemId);
      if (!snapshot) return;
      return {
        status: command ? command.status === "failed" ? "failed" : "running" : part.status,
        detail: command ? [part.detail, snapshot.output].filter(Boolean).join("\n") : part.detail ?? "",
        description: command && <p className="px-3 pb-2 text-muted-foreground text-xs">{t("chat.nativeBackground.started", { mode: t(PERMISSION_MODE_KEYS[command.permissionMode]) })}</p>,
      };
    };
  }, [commands, recent, t]);
  return <NativeCommands.Provider value={runtime}><ToolActivityProvider value={resolve}>{children}</ToolActivityProvider></NativeCommands.Provider>;
}
