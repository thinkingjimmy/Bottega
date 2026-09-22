/**
 * [INPUT]: Depends on trusted main-frame IPC, the scoped Chat reader and closed read/file schemas.
 * [OUTPUT]: Registers trusted main-frame Chat and Project deletion decisions, bounded retention discovery, continuation IPC and the signed-out catalog answer.
 * [POS]: Electron authority boundary; malformed or non-main callers never reach the account transport.
 */
import { z } from "zod";
import type { BrowserWindow } from "electron";
import { CHAT_CHANNEL, chatReadSchema, chatWatchSchema, chatCatalogRequestSchema, chatIdRequestSchema,
  chatFileOpenSchema, chatFileReadSchema, transcriptRequestSchema } from "../../../../shared/cloud/chat";
import { rendererIpc } from "../../ipc-registrar";
import type { CloudChatReader } from "./reader";
import type { CloudExecutionService } from "../execution/service";
import { executionDraftIdSchema, executionDraftWriteSchema } from "../../../../shared/cloud/execution";
import { chatFactsEditSchema, chatFactsDecisionSchema } from "../../../../shared/cloud/facts";
import { chatDeletionRequestSchema, chatDeletionKeepSchema } from "../../../../shared/cloud/deletion";
import { recoveryPageRequestSchema, recoveryFileRequestSchema, retainedCatalogRequestSchema } from "../../../../shared/cloud/recovery";
import { projectDeletionCatalogRequestSchema, projectDeletionIdentitySchema, projectDeletionDecisionSchema } from "../../../../shared/cloud/projects/deletion";
export function registerCloudChat(reader: CloudChatReader, execution: CloudExecutionService, window: BrowserWindow, rendererUrl: string) {
  const ipc = rendererIpc(rendererUrl, "Cloud Chat access denied").roles("main"), subscriptions = new Map<string, () => void>();
  const send = (value: { subscriptionId: string; value?: unknown; error?: boolean }) => { if (!window.isDestroyed()) window.webContents.send(CHAT_CHANNEL.changed, value); };
  ipc.handle(CHAT_CHANNEL.facts, (...args) => reader.facts(z.tuple([chatIdRequestSchema]).parse(args)[0].chatId));
  ipc.handle(CHAT_CHANNEL.deletion, (...args) => reader.deletion(z.tuple([chatIdRequestSchema]).parse(args)[0].chatId));
  ipc.handle(CHAT_CHANNEL.requestDeletion, (...args) => reader.requestDeletion(z.tuple([chatDeletionRequestSchema]).parse(args)[0]));
  ipc.handle(CHAT_CHANNEL.keepDeletion, (...args) => reader.keepDeletion(z.tuple([chatDeletionKeepSchema]).parse(args)[0]));
  ipc.handle(CHAT_CHANNEL.editFacts, (...args) => reader.editFacts(z.tuple([chatFactsEditSchema]).parse(args)[0]));
  ipc.handle(CHAT_CHANNEL.resolveFacts, (...args) => reader.resolveFacts(z.tuple([chatFactsDecisionSchema]).parse(args)[0]));
  ipc.handle(CHAT_CHANNEL.retainedCatalog, (...args) => reader.retainedCatalog(z.tuple([retainedCatalogRequestSchema]).parse(args)[0]));
  ipc.handle(CHAT_CHANNEL.retainedMetadata, (...args) => reader.retainedMetadata(z.tuple([recoveryPageRequestSchema]).parse(args)[0]));
  ipc.handle(CHAT_CHANNEL.projectDeletionCatalog, (...args) => reader.projectDeletionCatalog(z.tuple([projectDeletionCatalogRequestSchema]).parse(args)[0]));
  ipc.handle(CHAT_CHANNEL.reviewProjectDeletion, (...args) => reader.reviewProjectDeletion(z.tuple([projectDeletionIdentitySchema]).parse(args)[0].projectId));
  ipc.handle(CHAT_CHANNEL.resolveProjectDeletion, (...args) => reader.resolveProjectDeletion(z.tuple([projectDeletionDecisionSchema]).parse(args)[0]));
  ipc.handle(CHAT_CHANNEL.retryProjectDeletion, (...args) => reader.retryProjectDeletion(z.tuple([projectDeletionIdentitySchema]).parse(args)[0].projectId));
  ipc.handle(CHAT_CHANNEL.recoveryPage, (...args) => reader.recoveryPage(z.tuple([recoveryPageRequestSchema]).parse(args)[0]));
  ipc.handle(CHAT_CHANNEL.recoveryFile, (...args) => reader.recoveryFile(z.tuple([recoveryFileRequestSchema]).parse(args)[0]));
  /* 登录前渲染端仍可能问一次目录（账号已就绪、binding 还没落下的那个时序窗口）。
     答「还没登录」而不是抛 CHAT_ACCOUNT_UNAVAILABLE：主进程日志里那一串堆栈就是
     这么来的，而它从头到尾没有任何人要处理（N-1 / AC-8）。 */
  ipc.handle(CHAT_CHANNEL.catalog, async (...args) => {
    const [input] = z.tuple([chatCatalogRequestSchema]).parse(args);
    if (!reader.available()) return { kind: "signed-out" as const };
    return { kind: "catalog" as const, page: await reader.catalog(input) };
  });
  ipc.handle(CHAT_CHANNEL.head, (...args) => reader.head(z.tuple([chatIdRequestSchema]).parse(args)[0].chatId));
  ipc.handle(CHAT_CHANNEL.execution, (...args) => execution.read(z.tuple([chatIdRequestSchema]).parse(args)[0].chatId));
  ipc.handle(CHAT_CHANNEL.prepare, (...args) => execution.prepare(z.tuple([chatIdRequestSchema]).parse(args)[0].chatId));
  ipc.handle(CHAT_CHANNEL.bindProject, (...args) => execution.bindProject(z.tuple([chatIdRequestSchema]).parse(args)[0].chatId));
  ipc.handle(CHAT_CHANNEL.draft, (...args) => execution.draft(z.tuple([executionDraftIdSchema]).parse(args)[0]));
  ipc.handle(CHAT_CHANNEL.saveDraft, (...args) => { const [input] = z.tuple([executionDraftWriteSchema]).parse(args);
    return execution.draft({ chatId: input.chatId, incarnationId: input.incarnationId }, { expectedRevision: input.expectedRevision, text: input.text }); });
  ipc.handle(CHAT_CHANNEL.transcript, (...args) => reader.transcript(z.tuple([transcriptRequestSchema]).parse(args)[0]));
  ipc.handle(CHAT_CHANNEL.query, (...args) => { const [request] = z.tuple([chatReadSchema]).parse(args); return reader.query(request.name, request.input as never); });
  ipc.handle(CHAT_CHANNEL.watch, (...args) => {
    const [request] = z.tuple([chatWatchSchema]).parse(args);
    if (subscriptions.has(request.subscriptionId) || subscriptions.size >= 12) throw new Error("CHAT_SUBSCRIPTION_LIMIT");
    subscriptions.set(request.subscriptionId, reader.watch(request.name, request.input as never, value => send({ subscriptionId: request.subscriptionId, value }),
      () => send({ subscriptionId: request.subscriptionId, error: true })));
  });
  ipc.handle(CHAT_CHANNEL.unwatch, (...args) => {
    const [input] = z.tuple([z.object({ subscriptionId: z.string().uuid() }).strict()]).parse(args);
    subscriptions.get(input.subscriptionId)?.(); subscriptions.delete(input.subscriptionId);
  });
  ipc.handle(CHAT_CHANNEL.openFile, (...args) => { const [input] = z.tuple([chatFileOpenSchema]).parse(args); return reader.openFile([input.chatId, input.descriptor]); });
  ipc.handle(CHAT_CHANNEL.readFile, (...args) => { const [input] = z.tuple([chatFileReadSchema]).parse(args); return reader.readFile(input.leaseId, input.offset, input.length); });
  ipc.handle(CHAT_CHANNEL.closeFile, (...args) => reader.closeFile(z.tuple([z.object({ leaseId: z.string().uuid() }).strict()]).parse(args)[0].leaseId));
  const stop = reader.subscribe(() => send({ subscriptionId: "local" }));
  window.webContents.once("destroyed", () => { stop(); for (const unsubscribe of subscriptions.values()) unsubscribe(); subscriptions.clear(); });
}
