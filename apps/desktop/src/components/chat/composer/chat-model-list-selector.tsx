/**
 * [INPUT]: Shared model list, native failure view and i18next translator.
 * [OUTPUT]: Native list selector with original commit and capability semantics.
 * [POS]: Thin native adapter for the shared list selector.
 */
import { useTranslation } from "react-i18next";
import { ChatModelListSelector as SharedSelector, type ChatModelListSelectorProps } from "@ai-chat/chat-ui/models/list";
import { AgentFailureNotice } from "@/components/agent-failure-notice";
import type { AgentSurfaceFailure } from "@/lib/agent-failure";
export function ChatModelListSelector({ modelsError, ...props }: Omit<ChatModelListSelectorProps, "modelsError"> & { modelsError: AgentSurfaceFailure | null }) {
  const { t, i18n } = useTranslation();
  return <SharedSelector {...props} translate={t} locale={i18n.language} modelsError={modelsError && <AgentFailureNotice compact {...modelsError} />} />;
}
