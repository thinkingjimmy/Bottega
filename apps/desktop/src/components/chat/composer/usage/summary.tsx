/**
 * [INPUT]: Shared quota summary and host language.
 * [OUTPUT]: Native quota summary using the shared presentation policy.
 * [POS]: Thin native language adapter.
 */
import { QuotaSummaryText as SharedSummary } from "@ai-chat/chat-ui/quota/summary";
import type { AgentUsageLimits } from "@ai-chat/cloud-protocol/remote/quota";
import { useAppTranslation } from "@/components/providers/i18n-provider";
export function QuotaSummaryText(props: { agent: AgentUsageLimits; now: number; customProvider: boolean }) {
  const { i18n } = useAppTranslation();
  return <SharedSummary {...props} locale={i18n.language} />;
}
