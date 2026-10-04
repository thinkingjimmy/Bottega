/**
 * [INPUT]: Depends on Electron isolated IPC and the fixed remote channel names and bridge types.
 * [OUTPUT]: Exposes remote commands, watches and attachment transfers without main-process authority.
 * [POS]: Main-window preload adapter; it cannot invoke a local Agent or supply authentication headers. It carries no schemas (OPT-34): main parses every request, reply, watch value and progress event against the remote contracts.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { REMOTE_CHANNEL } from "../../../shared/ipc-channels/cloud";
import { type CloudRemoteBridge, type RemoteMethod, type RemoteInput, type RemoteResult, type RemoteWatch } from "../../../shared/cloud/remote/contracts";
export function installCloudRemoteBridge() {
  const call = <N extends RemoteMethod>(method: N, input: RemoteInput<N>): Promise<RemoteResult<N>> => ipcRenderer.invoke(REMOTE_CHANNEL[method], input);
  const watch = <N extends RemoteWatch>(method: N, input: RemoteInput<N>, changed: (value: RemoteResult<N>) => void, failed: () => void) => {
    const subscriptionId = crypto.randomUUID(); let current = true;
    const release = () => { if (!current) return; current = false; ipcRenderer.removeListener(REMOTE_CHANNEL.changed, receive);
      void ipcRenderer.invoke(REMOTE_CHANNEL.unwatch, { subscriptionId }).catch(() => {}); };
    const failure = () => { if (current) { release(); failed(); } };
    const receive = (_event: IpcRendererEvent, event: { subscriptionId: string; value?: unknown; error?: boolean }) => {
      if (!current || event.subscriptionId !== subscriptionId) return;
      if (event.error) failure(); else changed(event.value as RemoteResult<N>);
    };
    ipcRenderer.on(REMOTE_CHANNEL.changed, receive);
    void ipcRenderer.invoke(REMOTE_CHANNEL.watch, { method, input, subscriptionId })
      .then((result: { kind: string }) => { if (result.kind !== "watching") failure(); }, failure);
    return release;
  };
  contextBridge.exposeInMainWorld("cloudRemote", {
    stageAttachment: input => call("stageAttachment", input), cancelAttachment: input => call("cancelAttachment", input),
    watchAttachmentProgress: (uploadId, changed) => {
      const receive = (_event: IpcRendererEvent, value: { uploadId: string; progress: import("@ai-chat/cloud-protocol").FileProgress }) => { if (value.uploadId === uploadId) changed(value.progress); };
      ipcRenderer.on(REMOTE_CHANNEL.attachmentProgress, receive); return () => { ipcRenderer.removeListener(REMOTE_CHANNEL.attachmentProgress, receive); };
    },
    withdraw: input => call("withdraw", input),
    projectFiles: input => call("projectFiles", input),
    prepareCommand: input => call("prepareCommand", input), prepareCreate: input => call("prepareCreate", input),
    queue: input => call("queue", input), reorderQueue: input => call("reorderQueue", input),
    watchQueue: (input, changed, failed) => watch("queue", input, changed, failed),
    targets: input => call("targets", input), submit: input => call("submit", input), command: input => call("command", input),
    commands: input => call("commands", input), receipts: input => call("receipts", input), create: input => call("create", input),
    created: input => call("created", input), retryPreparation: input => call("retryPreparation", input),
    watchTargets: (input, changed, failed) => watch("targets", input, changed, failed),
    watchReceipts: (input, changed, failed) => watch("receipts", input, changed, failed),
    watchCommands: (input, changed, failed) => watch("commands", input, changed, failed),
  } satisfies CloudRemoteBridge);
}
