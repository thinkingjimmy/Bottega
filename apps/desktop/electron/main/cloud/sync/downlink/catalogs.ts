/**
 * [INPUT]: Depends on formal scoped catalog queries and the existing Chat/Project Store writers.
 * [OUTPUT]: Installs remote owner and App/Base metadata without re-decrypting unchanged Project heads, reports per-Project/per-Base discovery failures, hands unwatched Bases whose revision moved back for reconciliation and persists acknowledged Chat catalog positions.
 * [POS]: Desktop downlink discovery; portable identity never grants filesystem or App execution authority.
 */
import { protocolHeader, type CloudBuildConfig, type CloudFunctionResult } from "@ai-chat/cloud-protocol";
import type { FileCipherPort } from "@ai-chat/cloud-protocol/blobs/encrypted";
import { openProjectHead } from "@ai-chat/cloud-protocol/projects/encrypted/client";
import { openChatHead } from "@ai-chat/cloud-protocol/chats/encrypted/client";
import type { BaseFilePublisher } from "../bases/files";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { SyncScope } from "../../../../../shared/local-storage/contracts";
import type { ChatSyncStore } from "../chats/sources";
import type { ProjectStore } from "../../../projects/store/project-store";
import type { AccountTransport } from "../../runtime/transport";
import type { AppStore } from "../../../apps/store/app-store";
import type { BasePromotionService } from "../../../bases/base-promotion-service";
import type { BaseStore } from "../../../bases/base-store";
import { pullWorkspace } from "./workspace";
export type CatalogPorts = { crypto(): FileCipherPort; config: CloudBuildConfig; scope: SyncScope; chats: ChatSyncStore; projects?: ProjectStore;
  apps?: AppStore; bases?: BaseStore; promotion?: BasePromotionService;
  baseFiles?: Pick<BaseFilePublisher, "codec" | "admit">;
  transport: Pick<AccountTransport, "query">; current(): void; changed(): void; failure?(error: unknown): void;
  /* Bases without a live subscription learn about a remote commit here: the catalog carries each Base's
     cloud revision, so the sweep can hand the ones that moved back to the Base publisher. */
  refreshBase?(target: { ownerKey: string; baseId: string }): void };
export async function pullCatalogs(ports: CatalogPorts, includeProjects = true) {
  const { scope, chats, projects, transport } = ports, crypto = ports.crypto(), signal = new AbortController().signal;
  const header = { ...protocolHeader(ports.config), expectedUserId: scope.userId,
    encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } };
  if (projects && includeProjects) {
    let afterId: string | null = null, count = 0;
    do {
      ports.current(); const page: CloudFunctionResult<"projects/sync:page"> = await transport.query("projects/sync:page", { ...header, afterId }); ports.current();
      for (const raw of page.items) {
        // The wire head carries its revision in the clear and `accept` ignores an older one, so an unchanged Project costs no decrypt.
        const local = projects.get(raw.projectId);
        if (local?.sync && local.sync.cloudRevision >= raw.revision) continue;
        const project = await openProjectHead(raw, crypto, signal); ports.current();
        // One unconfirmed local Project must not abandon the rest of the catalog; the run reports it and retries the page later.
        try { await projects.portable.accept(scope, hashChatContent([scope, project]), project); ports.current(); }
        catch (error) { ports.current(); if (!ports.failure) throw error; ports.failure(error); }
      }
      count += page.items.length; if (count > 10000) throw new Error("PROJECT_CATALOG_BUDGET");
      if (!page.complete && (!page.cursor || page.cursor === afterId)) throw new Error("PROJECT_CATALOG_CURSOR_INVALID");
      afterId = page.cursor;
    } while (afterId !== null);
  }
  const visited: CloudChatHead[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    ports.current(); const local = await chats.read(scope, { type: "catalog-cursors" });
    if (local.type !== "catalog-cursors") throw new Error("CHAT_CATALOG_CURSOR_UNAVAILABLE");
    let afterRevision = local.value.chats;
    const { revision: throughRevision } = await transport.query("chats/metadata:catalog", header); ports.current();
    if (throughRevision < afterRevision) throw new Error("CHAT_CATALOG_REVISION_REGRESSION");
    try {
      while (afterRevision < throughRevision) {
        const page = await transport.query("chats/metadata:page", { ...header, afterRevision, throughRevision }); ports.current();
        const revision = page.complete ? throughRevision : page.cursor;
        if (revision === null || revision <= afterRevision || revision > throughRevision) throw new Error("CHAT_CATALOG_CURSOR_INVALID");
        const heads: CloudChatHead[] = [];
        for (const item of page.items) { heads.push(await openChatHead(item, crypto, signal)); ports.current(); }
        const action = { type: "apply-chat-catalog" as const, expectedRevision: afterRevision, revision, heads };
        await chats.mutate(scope, hashChatContent(["chat-catalog", scope, action]), action);
        visited.push(...heads);
        ports.current(); afterRevision = revision; ports.changed();
      }
      if (projects && includeProjects) {
        if (ports.apps && ports.bases) await pullWorkspace({ ...ports, apps: ports.apps, bases: ports.bases });
        ports.changed();
      }
      return visited;
    } catch (error) {
      if (!String(error).includes("chat-catalog-changed") || attempt === 2) throw error;
    }
  }
  return visited;
}
