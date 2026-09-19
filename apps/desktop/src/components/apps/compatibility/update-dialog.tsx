/**
 * [INPUT]: Depends on main-owned return requests, explicit update confirmation and the shared reminder.
 * [OUTPUT]: Presents standalone lifecycle compatibility failures and resumes the original installed App.
 * [POS]: Root-level lifecycle reminder; install and share dialogs retain their own replacement content.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { APP_COMPATIBILITY_EVENT } from "@/lib/apps-client";
import type { AppCompatibilityFailure } from "../../../../shared/app-host/contract";
const Content = lazy(() => import("./update-content"));
export function CompatibilityUpdateDialog() {
  const [request, setRequest] = useState<{ initial: AppCompatibilityFailure; returnFocus: HTMLElement | null; version: number }>();
  useEffect(() => {
    const show = (event: Event) => setRequest(previous => ({ initial: (event as CustomEvent<AppCompatibilityFailure>).detail,
      returnFocus: document.activeElement as HTMLElement | null, version: (previous?.version ?? 0) + 1 }));
    window.addEventListener(APP_COMPATIBILITY_EVENT, show);
    return () => window.removeEventListener(APP_COMPATIBILITY_EVENT, show);
  }, []);
  return request ? <Suspense fallback={null}><Content key={request.version} {...request} /></Suspense> : null;
}
