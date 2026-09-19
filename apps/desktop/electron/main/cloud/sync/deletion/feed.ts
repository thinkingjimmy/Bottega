/**
 * [INPUT]: Depends on fresh admitted crypto/session authority, the encrypted-space deletion feed and existing SQLite catalog cursors.
 * [OUTPUT]: Applies bounded deletion pages under one original session/space and one shared head revision before advancing the owner-specific durable cursor.
 * [POS]: Shared delivery ordering for Chat and Base owners; business retention stays in each Store.
 */
import { canonicalJson, protocolHeader, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import type { FileCipherPort } from "@ai-chat/cloud-protocol/blobs/encrypted";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { CloudTombstone } from "@ai-chat/cloud-protocol/lifecycle/model";
import type { SyncScope } from "../../../../../shared/local-storage/contracts";
import type { AccountTransport } from "../../runtime/transport";
import type { ChatSyncStore } from "../chats/sources";

export type DeletionFeedPorts = {
  scope: SyncScope; config: CloudBuildConfig; store: ChatSyncStore;
  transport: Pick<AccountTransport, "query">; crypto(): FileCipherPort; current(): void;
};
// `lifecycle/api:head` returns one global revision for every topic, so a caller may share a single query across a whole pass.
export type DeletionHead = { revision: number | null };
export async function pullDeletionPage(ports: DeletionFeedPorts,
  topic: "chatDeletions" | "baseDeletions" | "appDeletions" | "projectDeletions", apply: (marker: CloudTombstone) => Promise<void>, shared?: DeletionHead) {
  const { scope, store, transport } = ports;
  ports.current(); const crypto = ports.crypto();
  const identity = canonicalJson({ session: crypto.session, scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint });
  const current = () => {
    ports.current(); const active = ports.crypto();
    if (scope.environment !== ports.config.environmentId || active.session.userId !== scope.userId ||
      canonicalJson({ session: active.session, scope: active.scope, keyPackageFingerprint: active.keyPackageFingerprint }) !== identity) throw new Error("DELETION_SCOPE_CHANGED");
  };
  const header = { ...protocolHeader(ports.config), expectedUserId: scope.userId,
    encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } };
  current(); const cursor = await store.read(scope, { type: "catalog-cursors" }); current();
  if (cursor.type !== "catalog-cursors") throw new Error("DELETION_CURSOR_UNAVAILABLE");
  const afterRevision = cursor.value[topic];
  let revision = shared?.revision ?? null;
  if (revision === null) { revision = (await transport.query("lifecycle/api:head", header)).revision; current(); if (shared) shared.revision = revision; }
  if (revision < afterRevision) throw new Error("DELETION_CURSOR_REGRESSION");
  if (revision === afterRevision) return;
  const page = await transport.query("lifecycle/api:page", { ...header, afterRevision, throughRevision: revision }); current();
  if (page.cursor <= afterRevision || page.cursor > revision) throw new Error("DELETION_CURSOR_INVALID");
  for (const marker of page.items) { current(); await apply(marker); }
  current(); await store.mutate(scope, hashChatContent([topic, scope, afterRevision, page.cursor]),
    { type: "advance-catalog", topic, expectedRevision: afterRevision, revision: page.cursor });
  current();
}
