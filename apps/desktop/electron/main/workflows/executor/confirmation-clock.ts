/**
 * [INPUT]: Depends on the run contract's confirmation timings and the run ledger and notify ports.
 * [OUTPUT]: Provides checkConfirmationClock (Q16: reminders recorded before they are sent, expiry at 24 hours) and nextConfirmationDue (when the runtime's single timer should fire next).
 * [POS]: workflows/executor's confirmation clock, judged only from the ledger's durable requestedAt.
 */
import { CONFIRMATION_REMIND_AT_MS, CONFIRMATION_TIMEOUT_MS } from "@ai-chat/cloud-protocol/contracts/workflow/run";
import type { ExecutorPorts } from "./types";

/**
 * The confirmation clock (Q16), judged only from the ledger's durable `requestedAt` against the wall clock given, so a restart
 * or a wake from sleep checks once and nothing depends on an in-memory timer: 24 hours expires the confirmation and pauses the
 * run (no reminder); the 23rd hour sends the final reminder once; before that the first reminder goes out once. A reminder is
 * recorded before it is sent, so it is sent at most once.
 */
export async function checkConfirmationClock(ports: Pick<ExecutorPorts, "ledger" | "notify">, now: number) {
  for (const run of ports.ledger.list()) {
    if (run.state !== "waiting-human") continue;
    for (const pending of run.confirmations.filter(item => !item.decision && item.expiredAt === null)) {
      const waited = now - pending.requestedAt;
      if (waited >= CONFIRMATION_TIMEOUT_MS) { await ports.ledger.expireConfirmation(run.runId, pending.stepId, now); continue; }
      const reminder = waited >= CONFIRMATION_REMIND_AT_MS ? "final-hour" as const : "started" as const;
      /* Past the 23rd hour the first reminder is not sent late: only the final one. */
      if (pending.reminders.includes(reminder) || (reminder === "started" && pending.reminders.includes("final-hour"))) continue;
      await ports.ledger.remindConfirmation(run.runId, pending.stepId, reminder, now);
      ports.notify({ runId: run.runId, stepId: pending.stepId, reminder });
    }
  }
}

/** When the clock next has something to do, for the runtime's single timer; null when no confirmation waits. */
export function nextConfirmationDue(ports: Pick<ExecutorPorts, "ledger">, now: number) {
  let next: number | null = null;
  for (const run of ports.ledger.list()) {
    if (run.state !== "waiting-human") continue;
    for (const pending of run.confirmations.filter(item => !item.decision && item.expiredAt === null)) {
      const due = !pending.reminders.length ? now : !pending.reminders.includes("final-hour")
        ? pending.requestedAt + CONFIRMATION_REMIND_AT_MS : pending.requestedAt + CONFIRMATION_TIMEOUT_MS;
      next = next === null ? due : Math.min(next, due);
    }
  }
  return next;
}
