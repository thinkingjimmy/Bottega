/**
 * [INPUT]: Depends on canonical Chat/Project's unchangeable identity snapshot with core/domain
 * [OUTPUT]: Provides the only MemoryScopeSubject resolver that requires explicit mode/owner/generation, shared range attribution determination, Policy generation upgrades and stable Space/peer assertions
 * [POS]: The main/memory/core product sharing boundaries; Workspace path, default compatibility with provider not to participate in identity derivatives
 */

import {
  expectedPeerId,
  memorySpaceId,
  type MemoryScopeSubject,
  type MemorySpaceRef,
} from "./domain";
import type { MemorySharingMode } from "../../../../shared/settings-ipc";

const SPACE_KINDS_BY_SHARING_MODE: Readonly<
  Record<MemorySharingMode, readonly string[]>
> = Object.freeze({
  chat: Object.freeze(["chat"]),
  group: Object.freeze(["project", "standalone"]),
  personal: Object.freeze(["personal"]),
});

export type CanonicalMemoryScopeSnapshot = Readonly<{
  chatId: string;
  incarnationId: string;
  projectId: string | null;
}>;

export function resolveMemoryScopeSubject(
  snapshot: CanonicalMemoryScopeSnapshot,
  sharingMode: MemorySharingMode,
  scopeOwnerId: string
): MemoryScopeSubject {
  if (sharingMode === "chat") {
    return Object.freeze({
      kind: "chat",
      chatId: snapshot.chatId,
      incarnationId: snapshot.incarnationId,
    });
  }
  if (sharingMode === "personal") {
    return Object.freeze({ kind: "personal", scopeOwnerId });
  }
  return snapshot.projectId
    ? Object.freeze({ kind: "project", projectId: snapshot.projectId })
    : Object.freeze({ kind: "standalone", scopeOwnerId });
}

/** 只认由 memorySpaceId() 生成的 v2 身份；旧 mode/generation 自然出局。 */
export function memorySpaceBelongsToSharingScope(
  memorySpaceIdValue: string,
  sharingMode: MemorySharingMode,
  sharingGeneration: number
) {
  const segments = memorySpaceIdValue.split(":");
  return (
    segments[0] === "memory" &&
    segments[1] === "v2" &&
    segments.at(-1) === String(sharingGeneration) &&
    SPACE_KINDS_BY_SHARING_MODE[sharingMode].includes(segments[2] ?? "")
  );
}

export function memorySpaceForSubject(
  subject: MemoryScopeSubject,
  generation: number,
  sharingGeneration: number
): MemorySpaceRef {
  return Object.freeze(
    subject.kind === "project"
      ? { ...subject, generation, sharingGeneration }
      : { ...subject, sharingGeneration }
  );
}

export function resolvedMemorySpace(
  subject: MemoryScopeSubject,
  generation: number,
  sharingGeneration: number
) {
  const memorySpace = memorySpaceForSubject(
    subject,
    generation,
    sharingGeneration
  );
  const id = memorySpaceId(memorySpace);
  return Object.freeze({
    memorySpace,
    memorySpaceId: id,
    expectedPeerId: expectedPeerId(id),
  });
}
