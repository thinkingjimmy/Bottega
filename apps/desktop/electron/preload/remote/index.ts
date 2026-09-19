/**
 * [INPUT]: Depends on Electron isolated IPC and fixed remote request/result schemas.
 * [OUTPUT]: Exposes validated remote commands and attachment transfers without main-process authority.
 * [POS]: Main-window preload adapter; it cannot invoke a local Agent or supply authentication headers.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { REMOTE_CHANNEL, remoteRequests, remoteResults, remoteAttachmentProgressSchema, type CloudRemoteBridge, type RemoteMethod,
  type RemoteInput, type RemoteResult, type RemoteWatch } from "../../../shared/cloud/remote/contracts";
export function installCloudRemoteBridge() {
  const call = async <N extends RemoteMethod>(method: N, input: RemoteInput<N>): Promise<RemoteResult<N>> =>
    remoteResults[method].parse(await ipcRenderer.invoke(REMOTE_CHANNEL[method], remoteRequests[method].parse(input))) as RemoteResult<N>;
  const watch = <N extends RemoteWatch>(method: N, input: RemoteInput<N>, changed: (value: RemoteResult<N>) => void, failed: () => void) => {
    const subscriptionId = crypto.randomUUID(); let current = true;
    const release = () => { if (!current) return; current = false; ipcRenderer.removeListener(REMOTE_CHANNEL.changed, receive);
      void ipcRenderer.invoke(REMOTE_CHANNEL.unwatch, { subscriptionId }).catch(() => {}); };
    const failure = () => { if (current) { release(); failed(); } };
    const receive = (_event: IpcRendererEvent, event: { subscriptionId: string; value?: unknown; error?: boolean }) => {
      if (!current || event.subscriptionId !== subscriptionId) return;
      const result = remoteResults[method].safeParse(event.value);
      if (event.error || !result.success) failure(); else changed(result.data as RemoteResult<N>);
    };
    const request = remoteRequests[method].parse(input);
    ipcRenderer.on(REMOTE_CHANNEL.changed, receive);
    void ipcRenderer.invoke(REMOTE_CHANNEL.watch, { method, input: request, subscriptionId }).catch(failure);
    return release;
  };
  contextBridge.exposeInMainWorld("cloudRemote", {
    stageAttachment: input => call("stageAttachment", input), cancelAttachment: input => call("cancelAttachment", input),
    watchAttachmentProgress: (uploadId, changed) => {
      const receive = (_event: IpcRendererEvent, value: unknown) => { const parsed = remoteAttachmentProgressSchema.safeParse(value); if (parsed.success && parsed.data.uploadId === uploadId) changed(parsed.data.progress); };
      ipcRenderer.on(REMOTE_CHANNEL.attachmentProgress, receive); return () => { ipcRenderer.removeListener(REMOTE_CHANNEL.attachmentProgress, receive); };
    },
    withdraw: input => call("withdraw", input),
    projectFiles: input => call("projectFiles", input),
    prepareCommand: input => call("prepareCommand", input), prepareCreate: input => call("prepareCreate", input),
    queue: input => call("queue", input), reorderQueue: input => call("reorderQueue", input),
    watchQueue: (input, changed, failed) => watch("queue", input, changed, failed),
    targets: input => call("targets", input), submit: input => call("submit", input), command: input => call("command", input),
    commands: input => call("commands", input), selectExecutor: input => call("selectExecutor", input), create: input => call("create", input),
    created: input => call("created", input), retryPreparation: input => call("retryPreparation", input),
    watchTargets: (input, changed, failed) => watch("targets", input, changed, failed),
    watchCommand: (input, changed, failed) => watch("command", input, changed, failed),
    watchCommands: (input, changed, failed) => watch("commands", input, changed, failed),
  } satisfies CloudRemoteBridge);
}
