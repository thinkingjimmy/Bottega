/**
 * [INPUT]: Depends on in-memory canonical Chat metadata and the shared summary projection
 * [OUTPUT]: Provides sorted summaries, exact identity/ownership projections, adoption snapshot references, external-history bindings, and Project references
 * [POS]: Read-only ChatStore projection layer; it never reads durable storage, mutates records, or persists
 */

import type { SessionRef } from "../../../shared/agent-ipc";
import { summaryOfChat, type ChatMetadata } from "./chat-summary";
import { assertChatId } from "./chat-guards";

const clone = <T>(value: T): T => structuredClone(value);

export class ChatStoreProjection {
  constructor(private readonly metadata: ReadonlyMap<string, ChatMetadata>) {}

  list() {
    return [...this.metadata.values()]
      .sort(
        (left, right) =>
          right.updatedAt - left.updatedAt ||
          right.createdAt - left.createdAt ||
          left.id.localeCompare(right.id)
      )
      .map(summaryOfChat);
  }

  projectId(chatId: string) {
    return this.get(chatId)?.projectId;
  }

  chatRef(chatId: string) {
    const meta = this.get(chatId);
    return meta
      ? {
          id: meta.id,
          incarnationId: meta.incarnationId,
          title: meta.title,
          archivedAt: meta.archivedAt,
          projectId: meta.projectId,
          appRole: meta.appRole,
          context: clone(meta.context),
        }
      : null;
  }

  incarnationId(chatId: string) {
    return this.get(chatId)?.incarnationId;
  }

  homeDir(chatId: string) {
    return this.get(chatId)?.homeDir ?? undefined;
  }

  importOrigin(chatId: string) {
    return clone(this.get(chatId)?.importOrigin ?? null);
  }

  executionDir(chatId: string) {
    return this.get(chatId)?.importOrigin?.originalCwd;
  }

  adoptionSnapshotIds() {
    return new Set(
      [...this.metadata.values()].flatMap((record) =>
        record.importOrigin?.adoptionSnapshotId
          ? [record.importOrigin.adoptionSnapshotId]
          : []
      )
    );
  }

  baseIdentities() {
    return [...this.metadata.values()].map((record) => ({
      chatId: record.id,
      incarnationId: record.incarnationId,
      title: record.title,
    }));
  }

  bindings() {
    return [...this.metadata.values()]
      .filter(
        (record): record is ChatMetadata & { session: SessionRef } =>
          record.session !== null
      )
      .map((record) => ({
        chatId: record.id,
        session: record.session,
        projectId: record.projectId,
        importOrigin: record.importOrigin ?? null,
        snapshotDigest: record.snapshotDigest ?? null,
      }));
  }

  historyBindings() {
    return [...this.metadata.values()]
      .filter((record) => record.session !== null || Boolean(record.importOrigin))
      .map((record) => ({
        chatId: record.id,
        session: record.session ?? null,
        importOrigin: record.importOrigin ?? null,
        snapshotDigest: record.snapshotDigest ?? null,
      }));
  }

  byProject(projectId: string) {
    return [...this.metadata.values()]
      .filter((record) => record.projectId === projectId)
      .map((record) => record.id);
  }

  appRole(chatId: string) {
    return this.get(chatId)?.appRole;
  }

  projectReferences() {
    const references = new Map<string, { latestUpdatedAt: number }>();
    for (const record of this.metadata.values()) {
      if (!record.projectId) continue;
      const current = references.get(record.projectId)?.latestUpdatedAt ?? 0;
      references.set(record.projectId, {
        latestUpdatedAt: Math.max(current, record.updatedAt),
      });
    }
    return references;
  }

  private get(chatId: string) {
    assertChatId(chatId);
    return this.metadata.get(chatId);
  }
}
