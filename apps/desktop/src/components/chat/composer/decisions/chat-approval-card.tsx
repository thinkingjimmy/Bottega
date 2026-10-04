/**
 * [INPUT]: Portable interaction projections and an injected host translator.
 * [OUTPUT]: Shared native and remote approval/question presentation.
 * [POS]: apps/desktop/src/components/chat/composer/decisions; Chat interaction library; no IPC or execution authority.
 */
import type { AgentApprovalRequest } from "../../../../../shared/ipc/agent/agent-ipc";
import type { ComponentProps } from "react";
import { ChatApprovalCard as SharedCard } from "@ai-chat/chat-ui/interactions/approval";
import { InteractionTranslation } from "@ai-chat/chat-ui/interactions/translation";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
export function ChatApprovalCard(props: Omit<ComponentProps<typeof SharedCard>, "approval"> & { approval: AgentApprovalRequest }) {
  const { t } = useAppTranslation();
  return <InteractionTranslation.Provider value={t}><SharedCard {...props} /></InteractionTranslation.Provider>;
}
