/**
 * [INPUT]: Depends on the shared Agent backend identity and type-only TypeScript contracts
 * [OUTPUT]: Provides archiving targets, Agent-identified Chat archive projections carrying the read-only capability flag, immutable deletion modes, Memory rebuild previews, events, and ArchiveBridgeApi
 * [POS]: apps/desktop/shared/ipc/workspace; Shared Archive/Purge single IPC agreement, binding main/preload/renderer three-way data shapes
 */

import type { ProviderId } from "@ai-chat/cloud-protocol/contracts/provider";

export type ArchiveTarget =
  | { kind: "chat"; id: string }
  | { kind: "project"; id: string };

type ArchivedEntityBase = {
  title: string;
  archivedAt: number;
  memberCount: number;
  /** 只读内容（导入历史、旧版 App Edit）：可恢复，永不可永久删除。 */
  readOnly?: boolean;
};

export type ArchivedEntity =
  | (ArchivedEntityBase & {
      target: { kind: "chat"; id: string };
      /** A built-in or a package Provider's id (TASK-11 S3-b); a label only. */
      agent: ProviderId;
    })
  | (ArchivedEntityBase & {
      target: { kind: "project"; id: string };
    });

export type ArchiveSnapshot = {
  entities: ArchivedEntity[];
  revision: number;
};

export type ArchivePurgeMode = "local-only" | "cleanup-and-rebuild";

export type PurgeMemoryPreview = {
  providerId: string;
  providerDataInstanceId: string;
  hostname: string;
  model: string;
  chats: number;
  turns: number;
};

export type PurgePreview = {
  deletePaths: string[];
  retainedExternalBindings: string[];
  rootBaseCount: number;
  blockedReasons: string[];
  memory: PurgeMemoryPreview | null;
  executionToken: string;
};

export type ArchiveEvent = {
  type: "changed";
  snapshot: ArchiveSnapshot;
};

export const ARCHIVE_CHANNEL = {
  list: "archive:list",
  archive: "archive:archive",
  restore: "archive:restore",
  previewPurge: "archive:preview-purge",
  executePurge: "archive:execute-purge",
  event: "archive:event",
} as const;

export type ArchiveBridgeApi = {
  list: () => Promise<ArchiveSnapshot>;
  archive: (targets: ArchiveTarget[]) => Promise<ArchiveSnapshot>;
  restore: (targets: ArchiveTarget[]) => Promise<ArchiveSnapshot>;
  previewPurge: (targets: ArchiveTarget[]) => Promise<PurgePreview>;
  executePurge: (
    executionToken: string,
    targets: ArchiveTarget[],
    mode: ArchivePurgeMode
  ) => Promise<ArchiveSnapshot>;
  onEvent: (callback: (event: ArchiveEvent) => void) => () => void;
};
