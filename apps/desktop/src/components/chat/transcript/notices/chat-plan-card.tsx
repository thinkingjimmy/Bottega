/**
 * [INPUT]: Shared ConversationPlan, native translation and clipboard access.
 * [OUTPUT]: PlanCard, the native adapter for the shared Plan preview.
 * [POS]: Native transcript notice adapter; presentation lives in chat-ui.
 */
import type { ComponentProps } from "react";
import { ConversationPlan } from "@ai-chat/chat-ui/turn/plan";
import { writeClipboardText } from "@/lib/agent/agent-client";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
export function PlanCard(props: Omit<ComponentProps<typeof ConversationPlan>, "translate" | "copy">) {
  const { t } = useAppTranslation();
  return <ConversationPlan {...props} translate={t} copy={writeClipboardText} />;
}
