/**
 * [INPUT]: Depends on React, six Chat facades, account-fenced remote ports and public target deadlines.
 * [OUTPUT]: Provides stable target subscriptions, epoch/foreground/network reconnection and locally invalidated server-clock presence.
 * [POS]: Shared reactive composition; scoped target facts and server-clock estimates use one publication path.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { RemoteTarget } from "@ai-chat/cloud-protocol/remote/model";
import type { ChatPlatform } from "../contracts";
import type { RemoteExecutionPort, RemoteTargets } from "./contracts";
import { remoteCommandSession } from "./commands/registry";
export function useRemoteCommands(platform: ChatPlatform, chatId: string, incarnationId: string) {
  const port = platform.commands.remote;
  const session = useMemo(() => {
    return remoteCommandSession(platform, chatId, incarnationId);
  }, [platform, chatId, incarnationId]);
  useEffect(() => {
    if (port) session?.bind(port); session?.open();
    const resume = () => { if (document.visibilityState === "visible") session?.resubscribe(); };
    document.addEventListener("visibilitychange", resume); window.addEventListener("pageshow", resume); window.addEventListener("online", resume);
    return () => { session?.close(); document.removeEventListener("visibilitychange", resume); window.removeEventListener("pageshow", resume); window.removeEventListener("online", resume); };
  }, [session, port]);
  const empty = useMemo(() => ({ entries: [], error: false, more: false, loading: false }), []);
  const value = useSyncExternalStore(session?.subscribe ?? (() => () => {}), session?.snapshot ?? (() => empty));
  return { session, ...value };
}
type TargetState = { port: RemoteExecutionPort; chatId: string | null; projectId?: string | null; value: RemoteTargets | null; observedAt: number; serverNow: number; error: boolean };
export function useRemoteTargets(port: RemoteExecutionPort | undefined, chatId: string | null, projectId?: string | null) {
  const [state, setState] = useState<TargetState | null>(null), [version, refresh] = useState(0), [clock, setClock] = useState(Date.now);
  const epochs = useRef<{ port: RemoteExecutionPort; value: string } | null>(null);
  useEffect(() => {
    if (!port) return;
    let active = true;
    type Page = { cursor: string | null; value: RemoteTargets | null; stop?: () => void };
    const pages: Page[] = [];
    const trim = (index: number) => { for (const page of pages.splice(index)) page.stop?.(); };
    const publish = (value: RemoteTargets | null, serverTime?: number) => {
      if (!active) return;
      setState(previous => {
        const observedAt = Date.now(), current = previous?.port === port && previous.chatId === chatId && previous.projectId === projectId ? previous : null;
        return { port, chatId, projectId, value: value ?? current?.value ?? null, observedAt,
          serverNow: Math.max(serverTime ?? 0, current ? current.serverNow + Math.max(0, observedAt - current.observedAt) : serverTime ?? observedAt), error: value === null };
      });
    };
    const failed = () => publish(null);
    const reconcile = () => {
      const first = pages[0]?.value; if (!active || !first) return;
      const items: RemoteTarget[] = [], cursors = new Set<string>(); let serverTime = first.serverTime;
      for (let index = 0; index < pages.length; index++) {
        const page = pages[index].value; if (!page) return;
        if (page.sourceDeviceId !== first.sourceDeviceId || page.sourceProtocolVersion !== first.sourceProtocolVersion) { failed(); return; }
        items.push(...page.items); serverTime = Math.max(serverTime, page.serverTime);
        if (items.length > 1000) { failed(); return; }
        if (page.complete) {
          trim(index + 1);
          const value = JSON.stringify(items.map(item => [item.deviceId, item.connectionEpoch]).sort(([a], [b]) => String(a).localeCompare(String(b))));
          const previous = epochs.current; epochs.current = { port, value };
          if (previous?.port === port && previous.value !== value) refresh(current => current + 1);
          publish({ ...first, items }, serverTime);
          return;
        }
        if (!page.cursor || cursors.has(page.cursor) || items.length >= 1000 || index >= 999) { failed(); return; }
        cursors.add(page.cursor);
        if (pages[index + 1]?.cursor !== page.cursor) { trim(index + 1); watch(page.cursor); return; }
      }
    };
    const watch = (cursor: string | null) => {
      const page: Page = { cursor, value: null }, index = pages.length; pages.push(page);
      try {
        const stop = port.watchTargets({ chatId, cursor, ...(projectId !== undefined ? { projectId } : {}) }, value => {
          if (!active || pages[index] !== page) return;
          page.value = value; reconcile();
        }, () => { if (pages[index] === page) failed(); });
        if (active && pages[index] === page) page.stop = stop; else stop();
      } catch { failed(); }
    };
    watch(null);
    return () => { active = false; trim(0); };
  }, [port, chatId, projectId, version]);
  useEffect(() => {
    const interval = setInterval(() => setClock(Date.now()), 1000);
    const resume = () => { if (document.visibilityState === "visible") { setState(null); epochs.current = null; refresh(value => value + 1); setClock(Date.now()); } };
    document.addEventListener("visibilitychange", resume); window.addEventListener("pageshow", resume);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", resume); window.removeEventListener("pageshow", resume); };
  }, []);
  const current = state && state.port === port && state.chatId === chatId && state.projectId === projectId ? state : null, value = current?.value ?? null;
  const now = value ? current!.serverNow + Math.max(0, clock - current!.observedAt) : clock;
  const items: RemoteTarget[] = value?.items.map(item => ({ ...item, online: item.online && item.offlineAt !== null && now < item.offlineAt,
    lastSeenReason: item.offlineAt !== null && now >= item.offlineAt && (!item.lastSeenReason || item.lastSeenReason === "unknown") ? "network" : item.lastSeenReason })) ?? [];
  items.sort((a, b) => Number(b.deviceId === value?.localDeviceId) - Number(a.deviceId === value?.localDeviceId) || a.name.localeCompare(b.name));
  return { value, items, now, error: current?.error ?? false, refresh: () => refresh(value => value + 1) };
}
