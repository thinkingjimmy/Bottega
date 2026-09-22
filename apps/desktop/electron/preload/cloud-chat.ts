/**
 * [INPUT]: Depends on the isolated Electron bridge and closed Chat read/file contracts.
 * [OUTPUT]: Exposes validated Chat facts/deletion, fresh Project deletion review, retained catalogs, files and scoped continuation.
 * [POS]: Main-frame-only cloud presentation bridge; main validates every requested execution change without accepting paths or credentials.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { z } from "zod";
import { cloudChatHeadSchema } from "@ai-chat/cloud-protocol/chats/model";
import { transcriptPageSchema } from "@ai-chat/chat-ui/model";
import { parseChatReadResult } from "@ai-chat/chat-ui/read-source";
import { executionViewSchema } from "@ai-chat/chat-ui/contracts";
import { executionDraftSchema, executionDraftIdSchema, executionDraftWriteSchema } from "../../shared/cloud/execution";
import { chatFactsViewSchema, chatFactsEditSchema, chatFactsDecisionSchema } from "../../shared/cloud/facts";
import { chatDeletionViewSchema, chatDeletionRequestSchema, chatDeletionKeepSchema } from "../../shared/cloud/deletion";
import { recoveryPageRequestSchema, recoveryFileRequestSchema, recoveryPageSchema } from "../../shared/cloud/recovery";
import { retainedCatalogRequestSchema, retainedCatalogSchema, retainedMetadataSchema } from "../../shared/cloud/recovery";
import { projectDeletionCatalogRequestSchema, projectDeletionCatalogSchema, projectDeletionIdentitySchema, projectDeletionReviewSchema, projectDeletionDecisionSchema } from "../../shared/cloud/projects/deletion";
import { CHAT_CHANNEL, chatCatalogRequestSchema, chatCatalogResultSchema, chatFileOpenSchema, chatFileReadSchema, chatIdRequestSchema,
  transcriptRequestSchema, type CloudChatBridge } from "../../shared/cloud/chat";
export function installCloudChatBridge() {
  contextBridge.exposeInMainWorld("cloudChat", {
    deletion: async input => chatDeletionViewSchema.parse(await ipcRenderer.invoke(CHAT_CHANNEL.deletion, chatIdRequestSchema.parse(input))),
    requestDeletion: async input => chatDeletionViewSchema.parse(await ipcRenderer.invoke(CHAT_CHANNEL.requestDeletion, chatDeletionRequestSchema.parse(input))),
    keepDeletion: async input => chatDeletionViewSchema.parse(await ipcRenderer.invoke(CHAT_CHANNEL.keepDeletion, chatDeletionKeepSchema.parse(input))),
    facts: async input => chatFactsViewSchema.parse(await ipcRenderer.invoke(CHAT_CHANNEL.facts, chatIdRequestSchema.parse(input))),
    editFacts: async input => chatFactsViewSchema.parse(await ipcRenderer.invoke(CHAT_CHANNEL.editFacts, chatFactsEditSchema.parse(input))),
    resolveFacts: async input => chatFactsViewSchema.parse(await ipcRenderer.invoke(CHAT_CHANNEL.resolveFacts, chatFactsDecisionSchema.parse(input))),
    retainedCatalog: async input => retainedCatalogSchema.parse(await ipcRenderer.invoke(CHAT_CHANNEL.retainedCatalog, retainedCatalogRequestSchema.parse(input))),
    retainedMetadata: async input => retainedMetadataSchema.parse(await ipcRenderer.invoke(CHAT_CHANNEL.retainedMetadata, recoveryPageRequestSchema.parse(input))),
    projectDeletionCatalog: async input => projectDeletionCatalogSchema.parse(await ipcRenderer.invoke(CHAT_CHANNEL.projectDeletionCatalog, projectDeletionCatalogRequestSchema.parse(input))),
    reviewProjectDeletion: async input => projectDeletionReviewSchema.parse(await ipcRenderer.invoke(CHAT_CHANNEL.reviewProjectDeletion, projectDeletionIdentitySchema.parse(input))),
    resolveProjectDeletion: input => ipcRenderer.invoke(CHAT_CHANNEL.resolveProjectDeletion, projectDeletionDecisionSchema.parse(input)),
    retryProjectDeletion: input => ipcRenderer.invoke(CHAT_CHANNEL.retryProjectDeletion, projectDeletionIdentitySchema.parse(input)),
    recoveryPage: async input => recoveryPageSchema.parse(await ipcRenderer.invoke(CHAT_CHANNEL.recoveryPage, recoveryPageRequestSchema.parse(input))),
    recoveryFile: async input => z.object({ leaseId: z.string().uuid() }).strict().parse(await ipcRenderer.invoke(CHAT_CHANNEL.recoveryFile, recoveryFileRequestSchema.parse(input))),
    onLocalChanged: changed => {
      const receive = (_event: IpcRendererEvent, event: { subscriptionId: string }) => { if (event.subscriptionId === "local") changed(); };
      ipcRenderer.on(CHAT_CHANNEL.changed, receive); return () => ipcRenderer.removeListener(CHAT_CHANNEL.changed, receive);
    },
    catalog: async input => chatCatalogResultSchema.parse(await ipcRenderer.invoke(CHAT_CHANNEL.catalog, chatCatalogRequestSchema.parse(input))),
    head: async input => cloudChatHeadSchema.nullable().parse(await ipcRenderer.invoke(CHAT_CHANNEL.head, chatIdRequestSchema.parse(input))),
    execution: async input => executionViewSchema.parse(await ipcRenderer.invoke(CHAT_CHANNEL.execution, chatIdRequestSchema.parse(input))),
    prepare: input => ipcRenderer.invoke(CHAT_CHANNEL.prepare, chatIdRequestSchema.parse(input)),
    bindProject: async input => z.boolean().parse(await ipcRenderer.invoke(CHAT_CHANNEL.bindProject, chatIdRequestSchema.parse(input))),
    draft: async input => executionDraftSchema.parse(await ipcRenderer.invoke(CHAT_CHANNEL.draft, executionDraftIdSchema.parse(input))),
    saveDraft: async input => executionDraftSchema.parse(await ipcRenderer.invoke(CHAT_CHANNEL.saveDraft, executionDraftWriteSchema.parse(input))),
    transcript: async input => transcriptPageSchema.parse(await ipcRenderer.invoke(CHAT_CHANNEL.transcript, transcriptRequestSchema.parse(input))),
    query: async (name, input) => parseChatReadResult(name, await ipcRenderer.invoke(CHAT_CHANNEL.query, { name, input })) as never,
    watch: (name, input, changed, failed) => {
      const subscriptionId = crypto.randomUUID(); let current = true;
      const receive = (_event: IpcRendererEvent, event: { subscriptionId: string; value?: unknown; error?: boolean }) => {
        if (!current || event.subscriptionId !== subscriptionId) return;
        if (event.error) failed(); else { try { changed(parseChatReadResult(name, event.value) as never); } catch { failed(); } }
      };
      ipcRenderer.on(CHAT_CHANNEL.changed, receive);
      void ipcRenderer.invoke(CHAT_CHANNEL.watch, { name, input, subscriptionId }).catch(() => { if (current) failed(); });
      return () => { current = false; ipcRenderer.removeListener(CHAT_CHANNEL.changed, receive); void ipcRenderer.invoke(CHAT_CHANNEL.unwatch, { subscriptionId }).catch(() => {}); };
    },
    openFile: async input => z.object({ leaseId: z.string().uuid() }).strict().parse(await ipcRenderer.invoke(CHAT_CHANNEL.openFile, chatFileOpenSchema.parse(input))),
    readFile: async input => z.instanceof(Uint8Array).parse(await ipcRenderer.invoke(CHAT_CHANNEL.readFile, chatFileReadSchema.parse(input))),
    closeFile: input => ipcRenderer.invoke(CHAT_CHANNEL.closeFile, z.object({ leaseId: z.string().uuid() }).strict().parse(input)),
  } satisfies CloudChatBridge);
}
