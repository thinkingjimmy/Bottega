/**
 * [INPUT]: Portable interaction projections and an injected host translator.
 * [OUTPUT]: Shared native and remote approval/question presentation.
 * [POS]: Chat interaction library; no IPC or execution authority.
 */
import type { ComponentProps } from "react";
import { ChatUserInputSelector as SharedCard } from "@ai-chat/chat-ui/interactions/questions";
import { InteractionTranslation } from "@ai-chat/chat-ui/interactions/translation";
import { useAppTranslation } from "@/components/providers/i18n-provider";
export function ChatUserInputSelector(props: ComponentProps<typeof SharedCard>) {
  const { t } = useAppTranslation();
  return <InteractionTranslation.Provider value={t}><SharedCard {...props} /></InteractionTranslation.Provider>;
}
