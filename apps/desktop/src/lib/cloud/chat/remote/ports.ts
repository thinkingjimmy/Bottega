/**
 * [INPUT]: Depends on the fixed main-frame remote bridge and the current scoped account facade.
 * [OUTPUT]: Adapts the remote facade to trusted desktop IPC, including cancellable file staging and progress.
 * [POS]: Renderer adapter; main supplies credentials, connection epochs and trusted admission context.
 */
import { cloudAccountSource } from "../../client";
import type { AccountFacade } from "@ai-chat/chat-ui/contracts";
import type { RemoteCommandPort, RemoteExecutorPort, RemoteTargets } from "@ai-chat/chat-ui/remote-contracts";
import type { CloudRemoteBridge } from "../../../../../shared/cloud/remote/contracts";
declare global { interface Window { cloudRemote?: CloudRemoteBridge } }
const scopes = new WeakMap<CloudRemoteBridge, Map<string, object>>();
export function desktopRemotePorts(bridge: CloudRemoteBridge, account: AccountFacade, userId: string) {
  let enabled = false; const lifetime = new AbortController();
  const expectedDeviceId = account.snapshot().deviceId;
  const invalidate = () => {
    const value = cloudAccountSource.snapshot();
    if (value.encryption.status !== "unlocked" || value.profile?.userId !== userId || value.deviceId !== expectedDeviceId) { lifetime.abort(); stopLifetime(); }
  };
  const stopLifetime = cloudAccountSource.subscribe(invalidate);
  let owners = scopes.get(bridge); if (!owners) { owners = new Map(); scopes.set(bridge, owners); }
  const scopeKey = `${userId}/${account.snapshot().deviceId}`; let cacheScope = owners.get(scopeKey);
  if (!cacheScope) { cacheScope = {}; owners.set(scopeKey, cacheScope); }
  const current = () => {
    lifetime.signal.throwIfAborted(); const value = account.snapshot();
    if (value.profile?.userId !== userId || value.state !== "ready" || !value.deviceId || value.deviceId !== expectedDeviceId) throw new Error("REMOTE_ACCOUNT_UNAVAILABLE");
    return value.deviceId;
  };
  const call = async <T,>(run: () => Promise<T>) => { const deviceId = current(); const result = await run(); if (current() !== deviceId) throw new Error("REMOTE_ACCOUNT_CHANGED"); return result; };
  const execution = async (run: () => ReturnType<CloudRemoteBridge["selectExecutor"]>) => {
    const result = await call(run);
    if ("rejected" in result) throw Object.assign(new Error(result.rejected), { data: result.rejected });
    return result;
  };
  const watch = <T,>(run: (changed: (value: T) => void, failed: () => void) => () => void, changed: (value: T) => void, failed: (error: unknown) => void) => {
    let active = true, stop = () => {};
    try { const deviceId = current(); stop = run(value => { if (!active) return;
      try { if (current() !== deviceId) throw new Error("REMOTE_ACCOUNT_CHANGED"); changed(value); } catch (error) { failed(error); }
    }, () => { if (active) failed(new Error("REMOTE_UNAVAILABLE")); }); }
    catch (error) { failed(error); }
    return () => { active = false; stop(); };
  };
  const commands: RemoteCommandPort = {
    queue: { watch: (chatId, changed, failed) => watch((receive, reject) => bridge.watchQueue({ chatId }, receive, reject), changed, failed),
      reorder: input => call(() => bridge.reorderQueue(input)) },
    cacheScope, lifetime: lifetime.signal,
    attachments: { stage: async (input, signal, progress) => {
      current(); signal.throwIfAborted();
      const bytes = new Uint8Array(await input.file.arrayBuffer()); signal.throwIfAborted();
      const stop = bridge.watchAttachmentProgress(input.uploadId, progress), abort = () => { void bridge.cancelAttachment({ uploadId: input.uploadId }).catch(() => {}); };
      signal.addEventListener("abort", abort, { once: true });
      try { const result = await call(() => bridge.stageAttachment({ chatId: input.chatId, attachmentId: input.attachmentId, uploadId: input.uploadId,
        filename: input.file.name, mediaType: input.file.type, bytes })); signal.throwIfAborted(); return result; }
      finally { stop(); signal.removeEventListener("abort", abort); }
    } },
    withdraw: commandId => call(() => bridge.withdraw({ commandId })),
    prepare: input => call(() => bridge.prepareCommand(input)),
    submit: (input, frozen) => call(() => bridge.submit({ command: input, frozen })), get: commandId => call(() => bridge.command({ commandId })),
    page: (chatId, cursor) => call(() => bridge.commands({ chatId, cursor })),
    watch: (commandId, changed, failed) => watch((receive, reject) => bridge.watchCommand({ commandId }, receive, reject), changed, failed),
    watchPage: (chatId, cursor, changed, failed) => watch((receive, reject) => bridge.watchCommands({ chatId, cursor }, receive, reject), changed, failed),
  };
  const executor: RemoteExecutorPort = {
    projectFiles: async (input, signal) => { signal.throwIfAborted(); const value = await call(() => bridge.projectFiles(input)); signal.throwIfAborted(); return value; },
    targets: async input => { const page = await call(() => bridge.targets(input)); enabled = page.remoteControlEnabled; return page; },
    watchTargets: (input, changed, failed) => watch<RemoteTargets>((receive, reject) => bridge.watchTargets(input, receive, reject), page => { enabled = page.remoteControlEnabled; changed(page); }, failed),
    select: input => execution(() => bridge.selectExecutor(input)), prepareCreate: input => call(() => bridge.prepareCreate(input)), create: (input, frozen) => call(() => bridge.create({ input, frozen })),
    created: createOperationId => call(() => bridge.created({ createOperationId })), retryPreparation: input => execution(() => bridge.retryPreparation(input)),
  };
  invalidate();
  return { commands, executor, available: () => !lifetime.signal.aborted && enabled && account.snapshot().state === "ready" && account.snapshot().profile?.userId === userId && account.snapshot().deviceId === expectedDeviceId };
}
