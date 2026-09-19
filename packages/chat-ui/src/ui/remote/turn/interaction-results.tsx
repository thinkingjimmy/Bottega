/**
 * [INPUT]: Depends on shared interaction results, locale and compact interaction copy.
 * [OUTPUT]: Renders bounded accessible completion notices naming the winning device.
 * [POS]: Shared desktop/browser interaction-card footer; no command authority or local state.
 */
import type { InteractionResult } from "@ai-chat/cloud-protocol/turns/live";
import { interactionCopy } from "../../../i18n/copy";
export function InteractionResults({ results = [], locale = "en", copy = interactionCopy(locale) }: { results?: readonly InteractionResult[]; locale?: string; copy?: { handledOn: string } }) {
  return <div role="status" aria-live="polite">{results.slice(-3).map(result =>
    <p key={`${result.kind}:${result.interactionId}`} className="mb-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      {copy.handledOn.replace("{name}", result.resolvedBy.sourceDeviceName)}
    </p>)}</div>;
}
