/**
 * [INPUT]: Depends on shared App generation operations and composition-registered build participants.
 * [OUTPUT]: Provides the closed build participant registry and durable prepare/finalize/abort checkpoints.
 * [POS]: Generation lifecycle collaborator; participants cannot write directly to AppStore.
 */

import type {
  AppGenerationBuildCheckpoint,
  AppGenerationBuildOperation,
} from "../../../../shared/app-lifecycle";

export type AppGenerationBuildParticipant = {
  prepare(operation: AppGenerationBuildOperation): Promise<AppGenerationBuildCheckpoint>;
  finalize(operation: AppGenerationBuildOperation): Promise<AppGenerationBuildCheckpoint>;
  abort(operation: AppGenerationBuildOperation): Promise<AppGenerationBuildCheckpoint>;
};

export class AppGenerationBuildParticipantRegistry {
  private readonly participants = new Map<
    AppGenerationBuildCheckpoint["kind"],
    AppGenerationBuildParticipant
  >();

  register(
    kind: AppGenerationBuildCheckpoint["kind"],
    participant: AppGenerationBuildParticipant
  ) {
    if (this.participants.has(kind)) throw new Error(`${kind} participant 已注册`);
    this.participants.set(kind, participant);
  }

  require(kind: AppGenerationBuildCheckpoint["kind"]) {
    const participant = this.participants.get(kind);
    if (!participant) throw new Error(`${kind} participant 未注册`);
    return participant;
  }
}
