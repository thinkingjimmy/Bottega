/**
 * [INPUT]: Depends on durable raw submission custody, canonical hashes, workspace/conversation gates, and synchronous lifecycle operation tracking
 * [OUTPUT]: Provides coalesced live switch recovery and shared startup/live failure reconciliation for original submissions
 * [POS]: Resumes preparation under the original intent/hash; prepared or dispatched Agent turns never enter this recovery path
 */
import type { TrustedManualTurnSubmission } from "../../../../../shared/sections-ipc";
import { isChatMutationOutcomeUnknown } from "../../../chats/store/mutation-outcome";
import { requestOperation } from "../../../presence/lifecycle/start-fence";
import type { CoordinatorDependencies } from "../coordinator-runtime";
import { canonicalHash, codedError } from "../coordinator-values";
import type { RelayLedger } from "../relay-ledger";
import type { DispatchTracker } from "../scheduler/dispatch-tracker";
import { isReservationKind } from "./reservation-payload";

type ResumeSubmission = (submission: TrustedManualTurnSubmission) => Promise<unknown>;
type RecoveryRuntime = {
  dependencies: CoordinatorDependencies;
  dispatches: DispatchTracker;
  accepting(): boolean;
  runConversation<T>(conversationId: string, task: () => Promise<T>): Promise<T>;
  /** The caller already holds both lifecycle gates; only preparation may run. */
  resumeSubmission: ResumeSubmission;
  kick(conversationId: string): void;
};

export class SubmissionRecovery {
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(private readonly runtime: RecoveryRuntime) {}

  reconcile(intentId: string): Promise<void> {
    const active = this.inFlight.get(intentId);
    if (active) return active;
    const { dependencies, accepting, runConversation, resumeSubmission } = this.runtime;
    const reservation = rawReservation(dependencies.ledger, intentId);
    if (!accepting() || !reservation) return Promise.resolve();
    const work = this.runtime.dispatches.track(async (refine) => {
      const resumed = await dependencies.withWorkspaceLifecycle(() => runConversation(reservation.conversationId, async () => {
        // Admission may finish, or shutdown may start, while this query waits for the lock.
        const current = rawReservation(dependencies.ledger, intentId);
        if (!accepting() || !current) return false;
        if (current.submissionHash !== reservation.submissionHash || current.conversationId !== reservation.conversationId) {
          throw codedError("RESERVATION_CONFLICT");
        }
        const [submission] = await dependencies.ledger.pendingSubmissionReservations(intentId);
        if (!submission?.agentSwitch || !accepting()) return false;
        if (submission.intentId !== intentId || submission.turn.scope.conversationId !== current.conversationId ||
            canonicalHash(submission) !== current.submissionHash) throw codedError("RESERVATION_CONFLICT");
        refine({ ...requestOperation(current.conversationId, submission.turn.requestId,
          submission.precondition.kind === "existing" ? submission.precondition.incarnationId : submission.precondition.proposedIncarnationId),
          backend: submission.turn.turnOptions.backend });
        return resumeRawSubmission({ ...dependencies, resumeSubmission }, submission);
      }));
      if (resumed) this.runtime.kick(reservation.conversationId);
    }, { conversationId: reservation.conversationId, operationId: `submission:${intentId}`, generation: 1 })
      .finally(() => { this.inFlight.delete(intentId); });
    this.inFlight.set(intentId, work);
    void work.catch(cause => dependencies.chats.store.pushWarning(`Submission ${intentId} recovery query failed: ${String(cause)}`));
    return work;
  }
}

function rawReservation(ledger: RelayLedger, intentId: string) {
  return ledger.read(state => {
    const reservation = state.submissionReservations[intentId];
    return reservation?.state === "reserved" && !state.manualIntents[intentId] &&
      (isReservationKind(reservation.payload, "submission") || isReservationKind(reservation.payload, "submission-ref"))
      ? reservation : null;
  });
}

export async function resumeRawSubmission(
  input: Pick<CoordinatorDependencies, "ledger" | "chats"> & { resumeSubmission: ResumeSubmission },
  submission: TrustedManualTurnSubmission
): Promise<boolean> {
  try {
    await input.resumeSubmission(submission);
    return true;
  } catch (cause) {
    if (isChatMutationOutcomeUnknown(cause)) {
      input.chats.store.pushWarning(`Submission ${submission.intentId} still awaits its SQLite receipt: ${cause.operationId}`);
      return false;
    }
    const reason = cause instanceof Error ? cause.message : String(cause);
    await input.ledger.failRawSubmissionRecovery({
      intentId: submission.intentId,
      content: submission.content,
      message: `Submission recovery stopped: ${reason}. The original input remains recoverable.`,
    });
    input.chats.store.pushWarning(`Submission ${submission.intentId} recovery stopped: ${reason}`);
    return false;
  }
}
