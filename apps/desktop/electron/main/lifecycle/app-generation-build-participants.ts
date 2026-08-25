/**
 * [INPUT]: Depends on shared AppGenerationBuildCheckpoint/Operation; Participant registered by composition root
 * [OUTPUT]: Provides closed AppGenerationBuildParticipantRegistry, only accepting app-extension/base-gui/server-data-cutover three participants
 * [POS]: The lifecycle of the cross-Store build participant port; Participant not able to write to AppStore
 */

import type {
  AppGenerationBuildCheckpoint,
  AppGenerationBuildOperation,
} from "../../../shared/app-lifecycle";

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
