/**
 * [INPUT]: Canonical Chat identity, visible panel capability, native surface bridges and the composer append seam.
 * [OUTPUT]: A stable ArtifactHost with previews, subtree-scoped prose-link browser routing and draft-scoped follow-ups.
 * [POS]: Desktop adapter for the shared artifact UI; callbacks use current session state without remounting frames.
 */
import { useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import type { ArtifactHost } from "@ai-chat/chat-ui/artifacts";
import type { ArtifactBridge } from "../../../../shared/artifact-ipc";
import type { ChatSessionController } from "../runtime/use-chat-session";
import { useAppTranslation } from "@/components/providers/i18n-provider";
declare global { interface Window { artifacts?: ArtifactBridge } }
export function useDesktopArtifactHost(controller: ChatSessionController, root: RefObject<HTMLDivElement | null>, enableSidePanel: boolean): ArtifactHost {
  const { i18n } = useAppTranslation(), latest = useRef(controller);
  useLayoutEffect(() => { latest.current = controller; }, [controller]);
  const chatId = controller.transcript.chatId, incarnationId = controller.transcript.incarnationId ?? "";
  useLayoutEffect(() => {
    const lifetime = new AbortController();
    void import("./prose-links").then(({ registerProseLinks, openInBrowser }) => {
      registerProseLinks(node => root.current?.contains(node) ?? false, url => {
        void openInBrowser(url, enableSidePanel ? () => latest.current.sidePanel.openTabs({ target: "browser" }) : undefined).catch(console.warn);
      }, lifetime.signal);
    });
    return () => lifetime.abort();
  }, [root, enableSidePanel]);
  return useMemo(() => {
    let pending: Promise<ArtifactHost> | undefined;
    const load = () => pending ??= import("./actions").then(module => module.desktopArtifactActions(chatId, incarnationId, i18n.language, () => latest.current, root, enableSidePanel));
    type Action = "acquire" | "release" | "action" | "open" | "followUp" | "workbook" | "importBase";
    const call = <K extends Action>(key: K) => (...args: Parameters<Required<ArtifactHost>[K]>) => load().then(host => Reflect.apply(host[key]!, host, args));
    return { scope: `${chatId}:${incarnationId}`, locale: i18n.language, desktop: true, sidePanel: enableSidePanel,
      acquire: call("acquire"), release: call("release"), action: call("action"), open: call("open"),
      followUp: call("followUp"), workbook: call("workbook"), importBase: call("importBase") };
  }, [chatId, incarnationId, i18n.language, root, enableSidePanel]);
}
