/**
 * [INPUT]: Depends on the shared transcript divider row and the five-language continuation copy.
 * [OUTPUT]: Renders the imported-history continuation boundary, the only visible trace a continued import leaves.
 * [POS]: conversation/lineage's imported boundary beside fork.tsx; it states where the product conversation starts and never warns about the import itself.
 */
import { TranscriptDividerRow } from "@ai-chat/ui/components/conversation/layout";
import { continuationCopy } from "../../../i18n/continuation";
/* "changed" has no producer today and is kept because it completes the vocabulary of
   this fact: a source whose bytes moved is not a source that disappeared. */
export type ImportedSourceStatus = "match" | "changed" | "missing";
export function ImportedBoundary({ sourceStatus, locale }: { sourceStatus?: ImportedSourceStatus; locale: string }) {
  const copy = continuationCopy(locale);
  return <TranscriptDividerRow role="separator"><span data-imported-divider="">{
    sourceStatus === "missing" ? copy.importedMissing : sourceStatus === "changed" ? copy.importedChanged : copy.imported
  }</span></TranscriptDividerRow>;
}
