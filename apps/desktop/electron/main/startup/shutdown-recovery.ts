/**
 * [INPUT]: Depends on stopChatAdmission narrow reopen ports for each service, Agent restore playback and Coordinator access playback
 * [OUTPUT]: Provides a single-mode shutdown recovery gate from the first irreversible cleanup, and a stop-admission dependent recovery system; Gate only opens Coordinator after Agent recovery is successful
 * [POS]: The startup's shutdown compensation editor; seal previous durable queues Not closed, only real reverse operations of stopped dependencies→Agent→Coordinator
 */

type DependencyAdmission = {
  reopenAdmission(): void | Promise<void>;
};

type ReopenableDependency = {
  reopen(): void | Promise<void>;
};

type TurnCustodyAdmission = {
  openAdmission(): void;
};

export class ShutdownRecoveryGate {
  private irreversible = false;

  async runIrreversible<T>(task: () => T | Promise<T>) {
    this.irreversible = true;
    return task();
  }

  async recover(
    reopenDependencies: () => Promise<void>,
    recoverAgents: () => boolean,
    reopenCoordinator: () => void | Promise<void>,
    onFailure: (cause: unknown) => void
  ) {
    if (this.irreversible) return false;
    try {
      await reopenDependencies();
    } catch (cause) {
      onFailure(cause);
      return false;
    }
    try {
      if (!recoverAgents()) return false;
      await reopenCoordinator();
      return true;
    } catch (cause) {
      onFailure(cause);
      return false;
    }
  }
}

export async function reopenStoppedChatDependencies(
  dependencies: readonly (ReopenableDependency | null)[],
  reopenTitleAdmission: () => void,
  projectAdmission: ReopenableDependency | null,
  admissions: readonly (DependencyAdmission | null)[],
  turnCustody: TurnCustodyAdmission | null
) {
  for (const dependency of dependencies) await dependency?.reopen();
  reopenTitleAdmission();
  await projectAdmission?.reopen();
  for (const admission of admissions) await admission?.reopenAdmission();
  turnCustody?.openAdmission();
}
