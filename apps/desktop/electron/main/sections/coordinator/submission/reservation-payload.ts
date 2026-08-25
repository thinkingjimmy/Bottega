/**
 * [INPUT]: Depends on the ledger manual intent schema and legacy/raw/prepared reservation payload
 * [OUTPUT]: Provides prepared intent Resolving and reservation kind
 * [POS]: The coordinator submission's compatibility payload boundaries; State machines only consume standardized results
 */

import { manualIntentSchema } from "../state/ledger-schema";

export function preparedReservationIntent(payload: unknown) {
  if (isReservationKind(payload, "submission")) return null;
  const candidate =
    payload &&
    typeof payload === "object" &&
    "kind" in payload &&
    payload.kind === "intent" &&
    "value" in payload
      ? payload.value
      : payload;
  const parsed = manualIntentSchema.safeParse({
    ...(candidate as object),
    sequence: 0,
  });
  if (!parsed.success) return null;
  const { sequence: _sequence, ...intent } = parsed.data;
  return intent;
}

export function isReservationKind(
  payload: unknown,
  kind: "submission" | "submission-ref" | "intent"
) {
  return Boolean(
    payload &&
      typeof payload === "object" &&
      "kind" in payload &&
      payload.kind === kind
  );
}
