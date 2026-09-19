/**
 * [INPUT]: Depends on the shared feedback toast (the one Archive uses) and remote copy.
 * [OUTPUT]: Provides useRemoteFeedback — one composer toast at a time for send outcomes with nothing to attach to (not sent, capacity full, creation unknown, files rejected) plus transient notices for changes this device did not make.
 * [POS]: Remote composer outcome channel; persistent states never come through here, they live on their control.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Info, TriangleAlert } from "lucide-react";
import { FeedbackToast, FeedbackToastAction, showFeedbackToast, toast } from "@ai-chat/ui/components/ui/sonner";
import type { RemoteCopy } from "../../../i18n/remote";
/* "Until dismissed or resolved": a finite day rather than Infinity, which a timer would treat as zero. */
const STICKY_MS = 24 * 60 * 60_000;
export type RemoteOutcome = { title: string; description: string; action?: { label: string; run(): void }; sticky?: boolean };
export function useRemoteFeedback(copy: RemoteCopy) {
  const current = useRef<string | number | undefined>(undefined);
  const dismiss = useCallback(() => { if (current.current !== undefined) { toast.dismiss(current.current); current.current = undefined; } }, []);
  useEffect(() => dismiss, [dismiss]);
  const notify = useCallback((outcome: RemoteOutcome) => {
    dismiss();
    current.current = showFeedbackToast(id => <FeedbackToast icon={<TriangleAlert className="text-destructive" />} title={outcome.title} description={outcome.description}
      data-testid="remote-outcome-toast" onDismiss={() => { toast.dismiss(id); if (current.current === id) current.current = undefined; }}>
      {outcome.action && <FeedbackToastAction variant="secondary" onClick={() => { toast.dismiss(id); if (current.current === id) current.current = undefined; outcome.action!.run(); }}>{outcome.action.label}</FeedbackToastAction>}
    </FeedbackToast>, outcome.sticky ? { duration: STICKY_MS } : {});
  }, [dismiss]);
  const notSent = useCallback((description: string, action?: RemoteOutcome["action"], sticky = false) => notify({ title: copy.notSent, description, action, sticky }), [notify, copy.notSent]);
  /* A fact the user did not cause — another device took the chat — is announced once and never replaces a send outcome. */
  const notices = useRef<(string | number)[]>([]);
  const notice = useCallback((title: string) => {
    const id = showFeedbackToast(toastId => <FeedbackToast icon={<Info className="text-muted-foreground" />} title={title}
      data-testid="remote-notice-toast" onDismiss={() => { toast.dismiss(toastId); }} />);
    notices.current = [...notices.current, id];
  }, []);
  useEffect(() => () => { for (const id of notices.current) toast.dismiss(id); notices.current = []; }, []);
  return useMemo(() => ({ notify, notSent, notice, dismiss }), [notify, notSent, notice, dismiss]);
}
