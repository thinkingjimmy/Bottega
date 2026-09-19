/**
 * [INPUT]: Depends on main-held App reviews, durable original deletion requests and shared consent UI.
 * [OUTPUT]: Confirms all-device deletion, retains uncertain original requests and renews definitively expired reviews.
 * [POS]: Desktop App deletion adapter; main owns the reviewed revision, account fencing and persistent queue.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AppDeletionDialog, type AppDeletionPhase } from "@ai-chat/ui/components/account/app-deletion";
import type { CloudCopy } from "@ai-chat/ui/lib/cloud-copy/en";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import type { CloudAppCatalog, CloudAppDeleteReview } from "../../../../shared/cloud/apps/model";
type Item = CloudAppCatalog["items"][number];
export function CloudAppDeletionDialog({ userId, item, online, onClose }: { userId: string; item: Item; online: boolean; onClose(): void }) {
  const { t } = useAppTranslation(), copy = t("cloud.appDeletion", { returnObjects: true }) as CloudCopy["appDeletion"];
  const [phase, setPhase] = useState<AppDeletionPhase>(item.deletion?.status === "pending" ? "unknown" : item.deletion?.status ?? "reviewing");
  const [review, setReview] = useState<CloudAppDeleteReview | null>(null), [retainBase, setRetainBase] = useState(item.deletion?.retainBase ?? true);
  const lifetime = useRef({ live: true, sequence: 0, busy: false });
  const original = useRef(item.deletion ? { expectedUserId: userId, requestId: item.deletion.requestId, retainBase: item.deletion.retainBase } : null);
  const held = useRef<string | null>(null);
  const discard = useCallback((requestId: string) => { void window.cloudApps!.discardDeletion({ expectedUserId: userId, requestId }).catch(() => undefined); }, [userId]);
  const load = useCallback(async () => {
    const request = ++lifetime.current.sequence; setPhase("reviewing");
    try {
      const next = await window.cloudApps!.reviewDeletion({ expectedUserId: userId, appId: item.appId });
      if (!lifetime.current.live || request !== lifetime.current.sequence) { discard(next.requestId); return; }
      held.current = next.requestId; setReview(next); setPhase("ready");
    } catch { if (lifetime.current.live && request === lifetime.current.sequence) setPhase("failed"); }
  }, [userId, item.appId, discard]);
  useEffect(() => {
    const current = lifetime.current; current.live = true;
    if (!original.current) void load();
    return () => { current.live = false; current.sequence++; if (held.current) discard(held.current); };
  }, [load, discard]);
  const send = async () => {
    if (!online || lifetime.current.busy || (!original.current && !review)) return;
    original.current ??= { expectedUserId: userId, requestId: review!.requestId, retainBase };
    lifetime.current.busy = true; setPhase("submitting");
    try {
      const result = await window.cloudApps!.confirmDeletion(original.current);
      if (lifetime.current.live) {
        if (result === "review-expired") {
          original.current = null; if (held.current) discard(held.current); held.current = null;
          setReview(null); setPhase("expired");
        } else { setPhase(result === "deleted" ? "confirmed" : result); if (result === "deleted") onClose(); }
      }
    } catch { if (lifetime.current.live) setPhase("unknown"); }
    finally { lifetime.current.busy = false; }
  };
  const rereview = async () => {
    if (!online || lifetime.current.busy) return;
    lifetime.current.busy = true; setPhase("reviewing");
    try {
      if (original.current) await window.cloudApps!.dismissDeletion({ expectedUserId: userId, requestId: original.current.requestId });
      if (!lifetime.current.live) return;
      original.current = null; if (held.current) discard(held.current); held.current = null;
      await load();
    } catch { if (lifetime.current.live) setPhase("blocked"); }
    finally { lifetime.current.busy = false; }
  };
  return <AppDeletionDialog name={review?.name ?? item.name} phase={phase} connected={online} retainBase={retainBase} copy={copy}
    onRetainBaseChange={setRetainBase} onConfirm={() => void send()} onRetry={() => void send()} onReview={() => void rereview()} onClose={onClose} />;
}
