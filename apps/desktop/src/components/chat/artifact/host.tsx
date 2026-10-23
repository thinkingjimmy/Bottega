/**
 * [INPUT]: Canonical Chat identity, main workspace/event bridge, panel capability and original durable composer callbacks.
 * [OUTPUT]: Stable fixed-version Artifact workspace/native export host with scoped Browser routing and awaited draft/send handoff.
 * [POS]: Desktop adapter for the shared artifact UI; callbacks use current session state without remounting frames.
 */
import { useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import type { ArtifactHost } from "@ai-chat/chat-ui/artifacts";
import type { ArtifactBridge } from "../../../../shared/ipc/apps/artifact-ipc";
import type { ChatSessionController } from "../runtime/use-chat-session";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
declare global { interface Window { artifacts?: ArtifactBridge } }
export function useDesktopArtifactHost(controller: ChatSessionController, root: RefObject<HTMLDivElement | null>, enableSidePanel: boolean): ArtifactHost {
  const { i18n } = useAppTranslation(), latest = useRef(controller);
  useLayoutEffect(() => { latest.current = controller; }, [controller]);
  const chatId = controller.transcript.chatId, incarnationId = controller.transcript.incarnationId ?? "";
  useLayoutEffect(() => {
    const lifetime = new AbortController();
    void Promise.all([import("@ai-chat/chat-ui/link-router"), import("./browser")]).then(([{ registerProseLinks }, { desktopLinkPort }]) => {
      registerProseLinks(node => root.current?.contains(node) ?? false,
        desktopLinkPort(enableSidePanel ? () => latest.current.sidePanel.openTabs({ target: "browser" }) : undefined), lifetime.signal);
    });
    return () => lifetime.abort();
  }, [root, enableSidePanel]);
  return useMemo(() => {
    let pending: Promise<ArtifactHost> | undefined;
    const load = () => pending ??= import("./actions").then(module => module.desktopArtifactActions(chatId, incarnationId, i18n.language, () => latest.current, root, enableSidePanel));
    type Action = "acquire" | "release" | "action" | "open" | "followUp" | "sendReview" | "workbook" | "importBase";
    const call = <K extends Action>(key: K) => (...args: Parameters<Required<ArtifactHost>[K]>) => load().then(host => Reflect.apply(host[key]!, host, args));
    return { scope: `${chatId}:${incarnationId}`, locale: i18n.language, desktop: true, sidePanel: enableSidePanel,
      recover: async (fence, retry) => { if (!window.artifacts) throw new Error("artifact-unavailable"); return (await window.artifacts.workspace({ action: retry ? "retry-capture" : "capture-status", artifactId: fence.id, chatId, incarnationId }) as { fence: typeof fence | null }).fence; },
      workspace: input => { if (!window.artifacts) throw new Error("artifact-unavailable"); return window.artifacts.workspace({ ...input, chatId, incarnationId }); },
      workspaceEvents: listener => window.artifacts?.onWorkspaceEvent(listener) ?? (() => {}),
      preview: (fence, action) => { if (!window.artifacts) throw new Error("preview-service-unavailable"); return window.artifacts.preview({ chatId, incarnationId, artifactId: fence.service!.sessionId }, action); },
      keepPreview: fence => { if (!window.artifacts) throw new Error("preview-service-unavailable"); return window.artifacts.preview({ chatId, incarnationId, artifactId: fence.service!.sessionId }, "preview-keep-running"); },
      openPreview: url => import("./browser").then(module => module.openInBrowser(url, enableSidePanel ? () => latest.current.sidePanel.openTabs({ target: "browser" }) : undefined)),
      acquire: call("acquire"), release: call("release"), action: call("action"), open: call("open"),
      followUp: call("followUp"), sendReview: call("sendReview"), workbook: call("workbook"), importBase: call("importBase") };
  }, [chatId, incarnationId, i18n.language, root, enableSidePanel]);
}
