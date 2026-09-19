/**
 * [INPUT]: Shared model selector, native failure view and i18next translator.
 * [OUTPUT]: Native model/effort/speed selector with original commit semantics and visual geometry.
 * [POS]: Thin native adapter; all selector state and rendering live in the shared library.
 */
import { useTranslation } from "react-i18next";
import { ChatModelSelector as SharedSelector, type ChatModelSelectorProps } from "@ai-chat/chat-ui/models/selector";
import { AgentFailureNotice } from "@/components/agent-failure-notice";
import type { AgentSurfaceFailure } from "@/lib/agent-failure";
export function ChatModelSelector({ modelsError, ...props }: Omit<ChatModelSelectorProps, "modelsError"> & { modelsError: AgentSurfaceFailure | null }) {
  const { t, i18n } = useTranslation();
  return <SharedSelector {...props} translate={t} locale={i18n.language} modelsError={modelsError && <AgentFailureNotice compact {...modelsError} />} />;
}
