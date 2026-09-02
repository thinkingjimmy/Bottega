/**
 * [INPUT]: Depends on canonical App/Project/Chat/Base records and the migration journal checksum builder
 * [OUTPUT]: Provides ledger-specific and cross-ledger durable evidence snapshots for every information-architecture publication stage
 * [POS]: Pure startup adapter between domain stores and the replayable migration journal; it hashes facts without owning persistence
 */

import {
  appEditorProjectionOf,
  appSourceStateOf,
  type AppRecord,
} from "../../../shared/apps-ipc";
import { baseNavigationOf } from "../../../shared/bases-ipc";
import type { ChatSummary } from "../../../shared/chats-ipc";
import type { StoredProject } from "../projects/store/project-store-schema";
import type { ReadonlyBaseSnapshot } from "../bases/base-store-model";
import { informationArchitectureMigrationEvidence } from "./information-architecture-migration";

type BaseEntry = Readonly<{
  ownerKey: string;
  snapshot: ReadonlyBaseSnapshot;
}>;

export const appMigrationEvidence = (apps: readonly AppRecord[]) =>
  informationArchitectureMigrationEvidence(
    "apps",
    apps.map((app) => ({
      id: app.id,
      revision: app.lifecycleRevision,
      value: {
        editor: appEditorProjectionOf(app),
        editChatSlot: app.editChatSlot,
        activeUseChatSlot: app.activeUseChatSlot,
        activeUseSwitch: app.activeUseSwitch ?? null,
        sourceState: appSourceStateOf(app),
      },
    }))
  );

export const projectMigrationEvidence = (projects: readonly StoredProject[]) =>
  informationArchitectureMigrationEvidence(
    "projects",
    projects.map((project) => ({
      id: project.id,
      revision: project.projectLifecycleRevision,
      value: {
        workspaceBinding: project.workspaceBinding,
        role: project.role,
        nameSource: project.nameSource,
        deletionCheckpoint: project.deletionCheckpoint,
        resourceAdmissions: project.resourceAdmissions,
        appPlacements: project.appPlacements,
      },
    }))
  );

export const baseMigrationEvidence = (bases: readonly BaseEntry[]) =>
  informationArchitectureMigrationEvidence(
    "bases",
    bases.map(({ ownerKey, snapshot }) => ({
      id: ownerKey,
      revision: snapshot.meta.revision,
      value: {
        owner: snapshot.meta.owner,
        ownerInstanceId: snapshot.meta.ownerInstanceId,
        navigation: baseNavigationOf(snapshot.meta),
      },
    }))
  );

export const chatMigrationEvidence = (chats: readonly ChatSummary[]) =>
  informationArchitectureMigrationEvidence(
    "chats",
    chats.map((chat) => ({
      id: chat.id,
      revision: chat.chatRecordRevision ?? 0,
      value: {
        incarnationId: chat.incarnationId,
        projectId: chat.projectId,
        appRole: chat.appRole,
        context: chat.context,
        startState: chat.startState,
        titleSource: chat.titleSource,
        readOnlyReason: chat.readOnlyReason,
        chatMessageRevision: chat.chatMessageRevision,
      },
    }))
  );

export function referenceMigrationEvidence(input: Readonly<{
  apps: readonly AppRecord[];
  projects: readonly StoredProject[];
  bases: readonly BaseEntry[];
  chats: readonly ChatSummary[];
}>) {
  const facts = [
    ...input.apps.map((app) => ({
      id: `app:${app.id}`,
      revision: app.lifecycleRevision,
      value: {
        editChatSlot: app.editChatSlot,
        activeUseChatSlot: app.activeUseChatSlot,
        activeUseSwitch: app.activeUseSwitch ?? null,
      },
    })),
    ...input.projects.map((project) => ({
      id: `project:${project.id}`,
      revision: project.projectLifecycleRevision,
      value: {
        workspaceBinding: project.workspaceBinding,
        role: project.role,
        appPlacements: project.appPlacements,
      },
    })),
    ...input.bases.map(({ ownerKey, snapshot }) => ({
      id: `base:${ownerKey}`,
      revision: snapshot.meta.revision,
      value: {
        owner: snapshot.meta.owner,
        navigation: baseNavigationOf(snapshot.meta),
      },
    })),
    ...input.chats.map((chat) => ({
      id: `chat:${chat.id}`,
      revision: chat.chatRecordRevision ?? 0,
      value: {
        incarnationId: chat.incarnationId,
        projectId: chat.projectId,
        appRole: chat.appRole,
        context: chat.context,
      },
    })),
  ];
  return informationArchitectureMigrationEvidence("references", facts);
}

export const completionMigrationEvidence = (
  receipts: Readonly<Record<string, Readonly<{ committedAt: number }> | undefined>>
) =>
  informationArchitectureMigrationEvidence(
    "migration",
    Object.entries(receipts).flatMap(([stage, receipt]) =>
      receipt
        ? [{ id: stage, revision: receipt.committedAt, value: receipt }]
        : []
    )
  );
