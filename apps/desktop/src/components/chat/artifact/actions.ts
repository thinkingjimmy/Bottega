/**
 * [INPUT]: Current Chat controller, trusted artifact bridge and the existing composer append store.
 * [OUTPUT]: Native artifact actions, Base-revealing imports and draft-safe follow-ups loaded on first artifact interaction.
 * [POS]: Deferred desktop artifact capability implementation behind the lightweight host registry.
 */
import type { RefObject } from "react";
import type { ArtifactHost } from "@ai-chat/chat-ui/artifacts";
import { artifactFollowUpBlock } from "@ai-chat/cloud-protocol/artifacts/frame-security";
import type { ChatSessionController } from "../runtime/use-chat-session";
import { appendComposerText, readComposer } from "@/lib/chat-composer-store";
import { richInputDisplayText } from "../../../../shared/rich-input-projection";
import { openArtifactBrowser } from "./browser";
export function desktopArtifactActions(chatId: string, incarnationId: string, locale: string,
  current: () => ChatSessionController, root: RefObject<HTMLDivElement | null>, enableSidePanel: boolean): ArtifactHost {
    const ref = (artifactId: string) => ({ chatId, incarnationId, artifactId });
    const bridge = () => { if (!window.artifacts) throw new Error("artifact-unavailable"); return window.artifacts; };
    return { scope: `${chatId}:${incarnationId}`, locale: locale, desktop: true,
      acquire: fence => bridge().lease(ref(fence.id)),
      release: lease => { void window.artifacts?.release(lease.id).catch(() => undefined); },
      action: (fence, action) => fence.kind === "claude-artifact" && fence.url ? (window.app?.openExternal(fence.url) ?? Promise.reject(new Error("artifact-unavailable"))) : bridge().action(ref(fence.id), action),
      open: async fence => {
        if (fence.kind === "claude-artifact" && fence.url) {
          await openArtifactBrowser(fence.url, enableSidePanel ? () => current().sidePanel.openTabs({ target: "browser" }) : undefined);
        } else current().sidePanel.openArtifact(fence);
      },
      followUp: value => {
        if (current().transcript.chatId !== chatId || current().composer.inputDisabled) return;
        const draft = richInputDisplayText(readComposer(chatId).draft.richValue);
        const block = artifactFollowUpBlock(draft, value);
        if (block && appendComposerText(chatId, block)) {
          requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[contenteditable="true"][role="textbox"]')?.focus());
        }
      },
      workbook: fence => bridge().workbook(ref(fence.id)),
      importBase: async (fence, sheet, confirmed) => {
        const receipt = await bridge().importBase(ref(fence.id), sheet, confirmed);
        if (enableSidePanel) current().sidePanel.openTabs({ target: "base" });
        return receipt;
      },
    };
}
