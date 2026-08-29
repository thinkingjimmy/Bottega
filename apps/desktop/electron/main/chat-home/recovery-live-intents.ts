/**
 * [INPUT]: Depends on lifecycle intent identities and the relay coordinator's live manual-intent ids
 * [OUTPUT]: Provides liveChatHomeIntentIds, the single startup projection of every saga that may still own an uncommitted Chat Home
 * [POS]: Chat Home recovery policy boundary; prevents one durable journal from compensating work still owned by another journal
 */

import type { LifecycleIntent } from "../lifecycle/intent-types";

const CHAT_HOME_LIFECYCLE_KINDS = new Set<LifecycleIntent["kind"]>([
  "chat-slot",
]);

export function liveChatHomeIntentIds(
  manualIntentIds: Iterable<string>,
  lifecycleIntents: Iterable<
    Pick<LifecycleIntent, "intentId" | "kind" | "terminal">
  >
) {
  const live = new Set(manualIntentIds);
  for (const intent of lifecycleIntents) {
    if (!intent.terminal && CHAT_HOME_LIFECYCLE_KINDS.has(intent.kind)) {
      live.add(intent.intentId);
    }
  }
  return live;
}
