/**
 * [INPUT]: Validated interaction completion values, imported as types only.
 * [OUTPUT]: Bounded completion notices deduplicated by interaction identity.
 * [POS]: Pure native/Web projection helper; renderer use never loads wire schemas.
 */
import type { InteractionResult } from "../live";
export function resolvedInteractions(previous: readonly InteractionResult[] = [], result?: InteractionResult): InteractionResult[] {
  return result ? [...previous.filter(value => value.kind !== result.kind || value.interactionId !== result.interactionId), result].slice(-20) : [...previous];
}
