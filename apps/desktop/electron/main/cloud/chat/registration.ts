/**
 * [INPUT]: Depends on trusted main-frame IPC, the scoped Chat reader and closed read/file schemas.
 * [OUTPUT]: Registers trusted main-frame Chat and Project deletion decisions, bounded retention discovery, continuation IPC including Home snapshot Retry/Skip, and the signed-out catalog answer; live watch failures are classified transient or terminal and transient ones re-attach (T20-8b).
 * [POS]: Electron authority boundary; malformed or non-main callers never reach the account transport.
 */
import { z } from "zod";
import type { BrowserWindow } from "electron";
import { CHAT_CHANNEL, chatCatalogResultSchema, chatReadSchema, chatWatchSchema, chatCatalogRequestSchema, chatIdRequestSchema, homeSkipRequestSchema,
  chatFileOpenSchema, chatFileReadSchema, transcriptRequestSchema } from "../../../../shared/cloud/chat";
import { rendererIpc } from "../../registration/ipc-registrar";
import { replying } from "../replies";
import { cloudChatHeadSchema } from "@ai-chat/cloud-protocol/chats/model";
import { executionViewSchema } from "@ai-chat/chat-ui/contracts";
import type { CloudChatReader } from "./reader";
import type { CloudExecutionService } from "../execution/service";
import { executionDraftIdSchema, executionDraftSchema, executionDraftWriteSchema } from "../../../../shared/cloud/execution";
import { chatFactsEditSchema, chatFactsDecisionSchema, chatFactsViewSchema } from "../../../../shared/cloud/facts";
import { chatDeletionRequestSchema, chatDeletionKeepSchema, chatDeletionViewSchema } from "../../../../shared/cloud/deletion";
import { recoveryPageRequestSchema, recoveryPageSchema, recoveryFileRequestSchema, retainedCatalogRequestSchema, retainedCatalogSchema, retainedMetadataSchema } from "../../../../shared/cloud/recovery";
import { projectDeletionCatalogRequestSchema, projectDeletionCatalogSchema, projectDeletionIdentitySchema, projectDeletionReviewSchema, projectDeletionDecisionSchema } from "../../../../shared/cloud/projects/deletion";
const leaseSchema = z.object({ leaseId: z.string().uuid() }).strict();
/* Replies leave main in their contract's exact shape (OPT-34); transcript, query and watch values are already parsed by the reader with the same schemas. */
export function registerCloudChat(reader: CloudChatReader, execution: CloudExecutionService, window: BrowserWindow, rendererUrl: string) {
  const ipc = rendererIpc(rendererUrl, "Cloud Chat access denied").roles("main"), subscriptions = new Map<string, () => void>();
  const send = (value: { subscriptionId: string; value?: unknown; error?: boolean; transient?: boolean }) => { if (!window.isDestroyed()) window.webContents.send(CHAT_CHANNEL.changed, value); };
  ipc.handle(CHAT_CHANNEL.facts, replying(chatFactsViewSchema, (...args) => reader.facts(z.tuple([chatIdRequestSchema]).parse(args)[0].chatId)));
  ipc.handle(CHAT_CHANNEL.deletion, replying(chatDeletionViewSchema, (...args) => reader.deletion(z.tuple([chatIdRequestSchema]).parse(args)[0].chatId)));
  ipc.handle(CHAT_CHANNEL.requestDeletion, replying(chatDeletionViewSchema, (...args) => reader.requestDeletion(z.tuple([chatDeletionRequestSchema]).parse(args)[0])));
  ipc.handle(CHAT_CHANNEL.keepDeletion, replying(chatDeletionViewSchema, (...args) => reader.keepDeletion(z.tuple([chatDeletionKeepSchema]).parse(args)[0])));
  ipc.handle(CHAT_CHANNEL.editFacts, replying(chatFactsViewSchema, (...args) => reader.editFacts(z.tuple([chatFactsEditSchema]).parse(args)[0])));
  ipc.handle(CHAT_CHANNEL.resolveFacts, replying(chatFactsViewSchema, (...args) => reader.resolveFacts(z.tuple([chatFactsDecisionSchema]).parse(args)[0])));
  ipc.handle(CHAT_CHANNEL.retainedCatalog, replying(retainedCatalogSchema, (...args) => reader.retainedCatalog(z.tuple([retainedCatalogRequestSchema]).parse(args)[0])));
  ipc.handle(CHAT_CHANNEL.retainedMetadata, replying(retainedMetadataSchema, (...args) => reader.retainedMetadata(z.tuple([recoveryPageRequestSchema]).parse(args)[0])));
  ipc.handle(CHAT_CHANNEL.projectDeletionCatalog, replying(projectDeletionCatalogSchema, (...args) => reader.projectDeletionCatalog(z.tuple([projectDeletionCatalogRequestSchema]).parse(args)[0])));
  ipc.handle(CHAT_CHANNEL.reviewProjectDeletion, replying(projectDeletionReviewSchema, (...args) => reader.reviewProjectDeletion(z.tuple([projectDeletionIdentitySchema]).parse(args)[0].projectId)));
  ipc.handle(CHAT_CHANNEL.resolveProjectDeletion, (...args) => reader.resolveProjectDeletion(z.tuple([projectDeletionDecisionSchema]).parse(args)[0]));
  ipc.handle(CHAT_CHANNEL.retryProjectDeletion, (...args) => reader.retryProjectDeletion(z.tuple([projectDeletionIdentitySchema]).parse(args)[0].projectId));
  ipc.handle(CHAT_CHANNEL.recoveryPage, replying(recoveryPageSchema, (...args) => reader.recoveryPage(z.tuple([recoveryPageRequestSchema]).parse(args)[0])));
  ipc.handle(CHAT_CHANNEL.recoveryFile, replying(leaseSchema, (...args) => reader.recoveryFile(z.tuple([recoveryFileRequestSchema]).parse(args)[0])));
  /* 登录前渲染端仍可能问一次目录（账号已就绪、binding 还没落下的那个时序窗口）。
     答「还没登录」而不是抛 CHAT_ACCOUNT_UNAVAILABLE：主进程日志里那一串堆栈就是
     这么来的，而它从头到尾没有任何人要处理（N-1 / AC-8）。 */
  ipc.handle(CHAT_CHANNEL.catalog, replying(chatCatalogResultSchema, async (...args) => {
    const [input] = z.tuple([chatCatalogRequestSchema]).parse(args);
    if (!reader.available()) return { kind: "signed-out" as const };
    return { kind: "catalog" as const, page: await reader.catalog(input) };
  }));
  ipc.handle(CHAT_CHANNEL.head, replying(cloudChatHeadSchema.nullable(), (...args) => reader.head(z.tuple([chatIdRequestSchema]).parse(args)[0].chatId)));
  ipc.handle(CHAT_CHANNEL.execution, replying(executionViewSchema, (...args) => execution.read(z.tuple([chatIdRequestSchema]).parse(args)[0].chatId)));
  ipc.handle(CHAT_CHANNEL.prepare, (...args) => execution.prepare(z.tuple([chatIdRequestSchema]).parse(args)[0].chatId));
  ipc.handle(CHAT_CHANNEL.retryHome, (...args) => execution.retryHome(z.tuple([chatIdRequestSchema]).parse(args)[0].chatId));
  ipc.handle(CHAT_CHANNEL.skipHome, (...args) => { const [input] = z.tuple([homeSkipRequestSchema]).parse(args); return execution.skipHome(input.chatId, input.jobId); });
  ipc.handle(CHAT_CHANNEL.bindProject, replying(z.boolean(), (...args) => execution.bindProject(z.tuple([chatIdRequestSchema]).parse(args)[0].chatId)));
  ipc.handle(CHAT_CHANNEL.draft, replying(executionDraftSchema, (...args) => execution.draft(z.tuple([executionDraftIdSchema]).parse(args)[0])));
  ipc.handle(CHAT_CHANNEL.saveDraft, replying(executionDraftSchema, (...args) => { const [input] = z.tuple([executionDraftWriteSchema]).parse(args);
    return execution.draft({ chatId: input.chatId, incarnationId: input.incarnationId }, { expectedRevision: input.expectedRevision, text: input.text }); }));
  ipc.handle(CHAT_CHANNEL.transcript, (...args) => reader.transcript(z.tuple([transcriptRequestSchema]).parse(args)[0]));
  ipc.handle(CHAT_CHANNEL.query, (...args) => { const [request] = z.tuple([chatReadSchema]).parse(args); return reader.query(request.name, request.input as never); });
  ipc.handle(CHAT_CHANNEL.watch, (...args) => {
    const [request] = z.tuple([chatWatchSchema]).parse(args);
    if (subscriptions.has(request.subscriptionId) || subscriptions.size >= 12) throw new Error("CHAT_SUBSCRIPTION_LIMIT");
    subscriptions.set(request.subscriptionId, reader.watch(request.name, request.input as never, value => send({ subscriptionId: request.subscriptionId, value }),
      transient => send({ subscriptionId: request.subscriptionId, error: true, transient })));
  });
  ipc.handle(CHAT_CHANNEL.unwatch, (...args) => {
    const [input] = z.tuple([z.object({ subscriptionId: z.string().uuid() }).strict()]).parse(args);
    subscriptions.get(input.subscriptionId)?.(); subscriptions.delete(input.subscriptionId);
  });
  ipc.handle(CHAT_CHANNEL.openFile, replying(leaseSchema, (...args) => { const [input] = z.tuple([chatFileOpenSchema]).parse(args); return reader.openFile([input.chatId, input.descriptor]); }));
  ipc.handle(CHAT_CHANNEL.readFile, replying(z.instanceof(Uint8Array), (...args) => { const [input] = z.tuple([chatFileReadSchema]).parse(args); return reader.readFile(input.leaseId, input.offset, input.length); }));
  ipc.handle(CHAT_CHANNEL.closeFile, (...args) => reader.closeFile(z.tuple([z.object({ leaseId: z.string().uuid() }).strict()]).parse(args)[0].leaseId));
  const stop = reader.subscribe(() => send({ subscriptionId: "local" }));
  window.webContents.once("destroyed", () => { stop(); for (const unsubscribe of subscriptions.values()) unsubscribe(); subscriptions.clear(); });
}
