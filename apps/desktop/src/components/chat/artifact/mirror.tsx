/**
 * [INPUT]: Confirmed mirror Chat/computer identity, native Artifact workspace bridge and existing Browser controller.
 * [OUTPUT]: Native mirror fixed workspace/history/events and execution-owner commands alongside ordinary file/Browser actions.
 * [POS]: Mirror adapter for shared cards; remote bytes enter the normal local custody/gateway pipeline.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArtifactHostProvider, type ArtifactHost } from "@ai-chat/chat-ui/artifacts";
import { ArtifactPreview as ArtifactCard } from "@ai-chat/chat-ui/artifact-renderer";
import { remoteCopy } from "@ai-chat/chat-ui/remote-copy";
import { Dialog, DialogContent, DialogTitle } from "@ai-chat/ui/components/ui/dialog";
import type { ArtifactFence } from "../../../../shared/ipc/apps/artifact-ipc";
import { BrowserPanel } from "../browser/browser-panel";
import { useBrowserTabs } from "../browser/use-browser-tabs";
import { desktopLinkPort, openInBrowser } from "./browser";
export function MirrorArtifacts({ chatId, incarnationId, ownerDeviceId, locale, children, openPanel }: { chatId: string; incarnationId: string; ownerDeviceId: string | null; locale: string; children: ReactNode; openPanel?(fence: ArtifactFence, followUp?: ArtifactHost["followUp"]): void }) {
  const [preview, setPreview] = useState<{ fence: ArtifactFence; followUp?: ArtifactHost["followUp"] } | null>(null), [browserOpen, setBrowserOpen] = useState(false);
  const browser = useBrowserTabs(browserOpen), copy = remoteCopy(locale), scope = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const lifetime = new AbortController();
    void import("@ai-chat/chat-ui/link-router").then(({ registerProseLinks }) => {
      registerProseLinks(node => scope.current?.contains(node) ?? false, desktopLinkPort(() => setBrowserOpen(true)), lifetime.signal);
    });
    return () => lifetime.abort();
  }, []);
  const host = useMemo<ArtifactHost>(() => {
    const ref = (id: string) => ({ chatId, incarnationId, artifactId: id });
    const bridge = () => { if (!window.artifacts) throw new Error("artifact-unavailable"); return window.artifacts; };
    return { scope: `${chatId}:${incarnationId}`, locale, desktop: true, remoteReader: true, executionDeviceId: ownerDeviceId ?? undefined,
      workspace: input => bridge().workspace({ ...input, chatId, incarnationId }),
      workspaceEvents: listener => bridge().onWorkspaceEvent(listener),
      acquire: fence => bridge().lease(ref(fence.id)), release: lease => { void window.artifacts?.release(lease.id).catch(() => undefined); },
      action: (fence, action) => fence.kind === "claude-artifact" && fence.url ? (window.app?.openExternal(fence.url) ?? Promise.reject(new Error("artifact-unavailable"))) : bridge().action(ref(fence.id), action),
      open: async (fence, followUp) => {
        if (fence.kind === "claude-artifact" && fence.url) await openInBrowser(fence.url, () => setBrowserOpen(true));
        else if (openPanel) openPanel(fence, followUp);
        else setPreview({ fence, followUp });
      },
    };
  }, [chatId, incarnationId, ownerDeviceId, locale, openPanel]);
  /* display:contents keeps the mirror layout intact while giving prose links an owning subtree. */
  return <ArtifactHostProvider value={host}><div className="contents" ref={scope}>{children}</div><Dialog open={preview !== null || browserOpen} onOpenChange={open => { if (!open) { setPreview(null); setBrowserOpen(false); } }}>
    <DialogContent aria-describedby={undefined} style={{ width: "min(1024px, 95vw)", maxWidth: 1024, height: browserOpen ? "85vh" : undefined, maxHeight: "90vh", overflowY: "auto" }}>
      <DialogTitle>{browserOpen ? copy.localBrowser : preview?.fence.title}</DialogTitle>
      {browserOpen ? <BrowserPanel visible controller={browser} /> : preview && <ArtifactHostProvider value={{ ...host, followUp: async value => { await preview.followUp?.(value); setPreview(null); } }}><ArtifactCard fence={preview.fence} expanded /></ArtifactHostProvider>}
    </DialogContent></Dialog></ArtifactHostProvider>;
}
