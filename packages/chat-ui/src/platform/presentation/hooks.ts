/**
 * [INPUT]: Depends on React subscriptions, page visibility and the six injected account/execution platform contracts.
 * [OUTPUT]: Provides current account, bounded visible-surface device refresh, the account's computers with a live presence deadline, and generation-fenced execution reads.
 * [POS]: Shared presentation adapter; retained display facts never become execution or account authority.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import type { CloudComputer, CloudDevice } from "@ai-chat/cloud-protocol";
import type { AccountFacade, ExecutionFacade, ExecutionView } from "../contracts";
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
/** Minutes matter here, not seconds: the strip says "5 minutes ago" and the deadline is 90 seconds wide. */
const PRESENCE_TICK_MS = 15_000;
/**
 * The account's computers, live. `computers` is null until the first page arrives — and stays null on a host that
 * has not wired the subscription — so a caller can tell "not known yet" from "this account has none".
 */
export function useAccountComputers(account: AccountFacade) {
  const snapshot = useChatAccount(account), userId = snapshot.profile?.userId;
  const [value, setValue] = useState<{ account: AccountFacade; userId: string; computers: CloudComputer[] } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!userId || snapshot.state !== "ready" || !account.computers) return;
    let active = true;
    const stop = account.computers(computers => { if (active) setValue({ account, userId, computers }); },
      () => { /* Keep the last confirmed list through a temporary outage; the deadline below still retires it. */ });
    return () => { active = false; stop(); };
  }, [account, snapshot.state, userId]);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const interval = setInterval(tick, PRESENCE_TICK_MS);
    const resume = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", resume); window.addEventListener("pageshow", resume);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", resume); window.removeEventListener("pageshow", resume); };
  }, []);
  const current = value?.account === account && value.userId === userId ? value.computers : null;
  return { computers: current, now };
}
export function useChatExecution(chatId: string, execution: ExecutionFacade) {
  const [value, setValue] = useState<{ chatId: string; execution: ExecutionFacade; view: ExecutionView | null; failed: boolean } | null>(null);
  useEffect(() => {
    let active = true, revision = 0;
    const read = () => { const expected = ++revision; void execution.read(chatId).then(view => {
      if (active && revision === expected) setValue({ chatId, execution, view, failed: false });
    }).catch(() => { if (active && revision === expected) setValue(previous => ({ chatId, execution,
      view: previous?.chatId === chatId && previous.execution === execution ? previous.view : null, failed: true })); }); };
    const stop = execution.subscribe(chatId, read); read(); return () => { active = false; stop(); };
  }, [chatId, execution]);
  return value?.chatId === chatId && value.execution === execution ? value : { view: null, failed: false };
}
