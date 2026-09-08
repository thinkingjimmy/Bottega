/**
 * [INPUT]: Depends on stopChatAdmission narrow reopen ports for each service, Agent restore playback and Coordinator access playback
 * [OUTPUT]: Provides ShutdownRecoveryGate, a one-way-latched recovery gate that reopens Coordinator only after Agent recovery succeeds, and reopenStoppedChatDependencies to reverse stopped-dependency admission
 * [POS]: The startup shutdown-recovery module; recovery is a no-op once irreversible cleanup has begun, and only reverses admission for already-stopped dependencies
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
