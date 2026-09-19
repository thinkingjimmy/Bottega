/**
 * [INPUT]: Durable executor notice and current locale.
 * [OUTPUT]: Shared execution boundary with explicit stale-snapshot disclosure.
 * [POS]: conversation/lineage's execution divider for both platform adapters; never a composer status banner.
 */
import { TranscriptDividerRow } from "@ai-chat/ui/components/conversation/layout";
import { remoteCopy } from "../../../i18n/remote";
export function ExecutorBoundary({ notice, locale }: { notice: { toName: string; fromName: string; staleSnapshot?: boolean }; locale: string }) {
  const copy = remoteCopy(locale);
  return <TranscriptDividerRow role="separator"><span>{copy.executorDivider.replace("{name}", notice.toName)}
    {notice.staleSnapshot && ` · ${copy.staleFiles.replace("{name}", notice.fromName)}`}</span></TranscriptDividerRow>;
}
