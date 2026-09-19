/**
 * [INPUT]: Native Base ports, device catalog, host navigation and shared panel composition.
 * [OUTPUT]: Desktop panel adapter with retained open intent, narrow takeover and panel memory bound to the chat's own conversation kind.
 * [POS]: Platform glue; shared Chat panel owns tabs, previews, geometry and focus.
 */
import { desktopPanelMemory, desktopPanelWidths } from "./memory";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import { CLOUD_CHAT_CAPABILITIES, type TranscriptSource } from "@ai-chat/chat-ui/contracts";
import { useChatSidePanel } from "@ai-chat/chat-ui/side-panel/host/panel";
import { useChatDevices } from "@/lib/cloud/chat/devices";
import { DesktopPanelBase, usePanelBase, usePanelBaseCreation } from "./base";
function useHistory(allowed: boolean, narrow: boolean, initial: boolean, onIntent: (open: boolean) => void) {
  const [intent, setIntent] = useState(initial);
  const openShell = useCallback(() => { if (allowed) { setIntent(true); onIntent(true); } }, [allowed, onIntent]);
  const close = useCallback(() => { setIntent(false); onIntent(false); }, [onIntent]);
  useEffect(() => {
    if (!intent || !narrow) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [intent, narrow, close]);
  return { open: allowed && intent, takeover: allowed && intent && narrow, openShell, close };
}
export function useDesktopPanelServices(head: CloudChatHead) {
  const navigate = useNavigate(), { devices } = useChatDevices(), createBase = usePanelBaseCreation();
  const { conversationKind, appId, projectId } = head.chat.classification;
  // The classification object is rebuilt with every head; its three fields are the identity that matters.
  const memory = useMemo(() => desktopPanelMemory({ conversationKind, appId, projectId }), [conversationKind, appId, projectId]);
  return { memory, widths: desktopPanelWidths, capabilities: CLOUD_CHAT_CAPABILITIES, useBase: usePanelBase, BaseTab: DesktopPanelBase, createBase, useHistory,
    deviceName: devices.find(device => device.deviceId === head.executorDeviceId)?.name, navigate: (path: string) => void navigate(path) };
}
export function useDesktopChatPanel(head: CloudChatHead, source: TranscriptSource, locale: string) {
  return useChatSidePanel(head, source, locale, useDesktopPanelServices(head));
}
