/**
 * [INPUT]: No running dependence, only using type-sequence TypeScript
 * [OUTPUT]: Provides archiving target, explicitly archiving template projection, immutable deleting mode, Memory, rebuilding previews, events with ArchiveBridgeApi
 * [POS]: Shared Archive/Purge single IPC agreement, binding main/preload/renderer three-way data shapes
 */

export type ArchiveTarget =
  | { kind: "chat"; id: string }
  | { kind: "project"; id: string };

export type ArchivedEntity = {
  target: ArchiveTarget;
  title: string;
  archivedAt: number;
  memberCount: number;
};

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
  pinnedBaseCount: number;
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
