/**
 * [INPUT]: Original Chat controller, trusted reference/workspace bridge, composer append/submission owner and durable flush acknowledgement.
 * [OUTPUT]: Lazy native file/Base actions and exact-reference draft/send handoff that preserves unrelated drafts and failed/unknown input.
 * [POS]: Deferred desktop artifact capability implementation behind the lightweight host registry.
 */
import type { RefObject } from "react";
import type { ArtifactHost } from "@ai-chat/chat-ui/artifacts";
import { artifactFollowUpBlock } from "@ai-chat/cloud-protocol/artifacts/frame-security";
import type { ChatSessionController } from "../runtime/use-chat-session";
import { appendComposerText, readComposer } from "@/lib/chat/state/composer/chat-composer-store";
import { richInputDisplayText } from "../../../../shared/content/rich/rich-input-projection";
import { openInBrowser } from "./browser";
import { flushDurableDrafts } from "@/lib/chat-composer/durable/durable";
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
          await openInBrowser(fence.url, enableSidePanel ? () => current().sidePanel.openTabs({ target: "browser" }) : undefined);
        } else current().sidePanel.openArtifact(fence);
      },
      followUp: async value => {
        if (current().transcript.chatId !== chatId || current().transcript.incarnationId !== incarnationId || current().composer.inputDisabled) throw new Error("Original Chat draft is unavailable");
        if (value.design) await bridge().workspace({ action: "reference-check", chatId, incarnationId, reference: value.design });
        if (current().transcript.chatId !== chatId || current().transcript.incarnationId !== incarnationId) throw new Error("Original Chat draft changed");
        const draft = richInputDisplayText(readComposer(chatId).draft.richValue);
        const block = artifactFollowUpBlock(draft, value);
        if (appendComposerText(chatId, block ?? "", value.design ? { name: value.title ?? value.design.documentId, reference: value.design } : undefined)) {
          if (!(await flushDurableDrafts()).saved) throw new Error("Original draft checkpoint could not be saved");
          requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[contenteditable="true"][role="textbox"]')?.focus());
        } else if (block) throw new Error("Review exceeds the current draft budget");
      },
      workbook: fence => bridge().workbook(ref(fence.id)),
      sendReview: async value => {
        if (current().transcript.chatId !== chatId || current().transcript.incarnationId !== incarnationId || current().composer.inputDisabled) throw new Error("Original Chat is unavailable");
        await bridge().workspace({ action: "reference-check", chatId, incarnationId, reference: value.design });
        if (current().transcript.chatId !== chatId || current().transcript.incarnationId !== incarnationId) throw new Error("Original Chat changed");
        const richValue = [{ id: `review_${value.requestId}`, type: "design" as const, name: value.title ?? value.design.documentId, reference: value.design },
          { id: `review_text_${value.requestId}`, type: "text" as const, value: value.prompt }];
        await current().composer.handleSubmit({ input: { kind: "rich", value: richValue, displayText: richInputDisplayText(richValue) }, files: [],
          requestKey: { id: value.requestId, createdAt: value.createdAt } });
        if (!(await flushDurableDrafts()).saved) throw new Error("Original queue checkpoint could not be saved");
      },
      importBase: async (fence, sheet, confirmed) => {
        const receipt = await bridge().importBase(ref(fence.id), sheet, confirmed);
        if (enableSidePanel) current().sidePanel.openTabs({ target: "base" });
        return receipt;
      },
    };
}
