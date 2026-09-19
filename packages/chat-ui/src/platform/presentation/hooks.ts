/**
 * [INPUT]: Depends on React subscriptions, page visibility and the six injected account/execution platform contracts.
 * [OUTPUT]: Provides current account, bounded visible-surface device refresh and generation-fenced execution reads.
 * [POS]: Shared presentation adapter; retained display facts never become execution or account authority.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import type { CloudDevice } from "@ai-chat/cloud-protocol";
import type { AccountFacade, ExecutorFacade, ExecutionView } from "../contracts";
export function useChatAccount(account: AccountFacade) {
  return useSyncExternalStore(account.subscribe, account.snapshot, account.snapshot);
}
export function useAccountDevices(account: AccountFacade) {
  const snapshot = useChatAccount(account), userId = snapshot.profile?.userId;
  const [value, setValue] = useState<{ account: AccountFacade; userId: string; devices: CloudDevice[] } | null>(null);
  useEffect(() => {
    if (!userId || snapshot.state !== "ready") return;
    let current = true, busy = false, generation = 0, interval: ReturnType<typeof setInterval> | undefined;
    const refresh = async () => {
      if (busy || document.visibilityState === "hidden") return; busy = true;
      const expected = generation;
      try {
        let cursor: string | null = null; const devices: CloudDevice[] = [], cursors = new Set<string>();
        do {
          const page = await account.devices(cursor); if (!current || expected !== generation) return;
          devices.push(...page.devices); if (devices.length > 1000) throw new Error("DEVICE_CATALOG_LIMIT");
          if (page.complete) break;
          if (!page.cursor || cursors.has(page.cursor) || cursors.size >= 1000) throw new Error("DEVICE_CATALOG_CURSOR");
          cursor = page.cursor; cursors.add(cursor);
        } while (current);
        if (current) setValue({ account, userId, devices });
      } catch { /* Keep the last confirmed display facts through a temporary outage. */ }
      finally { busy = false; if (current && expected !== generation) void refresh(); }
    };
    const visibility = () => {
      generation++; clearInterval(interval);
      if (document.visibilityState === "hidden") return;
      void refresh(); interval = setInterval(() => { void refresh(); }, 30_000);
    };
    visibility(); document.addEventListener("visibilitychange", visibility);
    return () => { current = false; clearInterval(interval); document.removeEventListener("visibilitychange", visibility); };
  }, [account, snapshot.state, userId]);
  return { account: snapshot, devices: value?.account === account && value.userId === userId ? value.devices : [] };
}
export function useChatExecution(chatId: string, executor: ExecutorFacade) {
  const [value, setValue] = useState<{ chatId: string; executor: ExecutorFacade; view: ExecutionView | null; failed: boolean } | null>(null);
  useEffect(() => {
    let active = true, revision = 0;
    const read = () => { const expected = ++revision; void executor.read(chatId).then(view => {
      if (active && revision === expected) setValue({ chatId, executor, view, failed: false });
    }).catch(() => { if (active && revision === expected) setValue(previous => ({ chatId, executor,
      view: previous?.chatId === chatId && previous.executor === executor ? previous.view : null, failed: true })); }); };
    const stop = executor.subscribe(chatId, read); read(); return () => { active = false; stop(); };
  }, [chatId, executor]);
  return value?.chatId === chatId && value.executor === executor ? value : { view: null, failed: false };
}
