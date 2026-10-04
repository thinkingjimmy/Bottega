/**
 * [INPUT]: Depends on the isolated Electron bridge and the Chat IPC channel names and bridge types.
 * [OUTPUT]: Exposes Chat facts/deletion, fresh Project deletion review, retained catalogs, files and scoped continuation with Home snapshot Retry/Skip; live watch failures are classified transient or terminal and transient ones re-attach (T20-8b).
 * [POS]: apps/desktop/electron/preload/cloud; Main-frame-only cloud presentation bridge. It carries no schemas (OPT-34): main parses every request and sends every reply and watch value in its contract's exact shape.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { CHAT_CHANNEL } from "../../../shared/ipc-channels/cloud";
import { type CloudChatBridge } from "../../../shared/cloud/chat";
export function installCloudChatBridge() {
  contextBridge.exposeInMainWorld("cloudChat", {
    deletion: input => ipcRenderer.invoke(CHAT_CHANNEL.deletion, input),
    requestDeletion: input => ipcRenderer.invoke(CHAT_CHANNEL.requestDeletion, input),
    keepDeletion: input => ipcRenderer.invoke(CHAT_CHANNEL.keepDeletion, input),
    facts: input => ipcRenderer.invoke(CHAT_CHANNEL.facts, input),
    editFacts: input => ipcRenderer.invoke(CHAT_CHANNEL.editFacts, input),
    resolveFacts: input => ipcRenderer.invoke(CHAT_CHANNEL.resolveFacts, input),
    retainedCatalog: input => ipcRenderer.invoke(CHAT_CHANNEL.retainedCatalog, input),
    retainedMetadata: input => ipcRenderer.invoke(CHAT_CHANNEL.retainedMetadata, input),
    projectDeletionCatalog: input => ipcRenderer.invoke(CHAT_CHANNEL.projectDeletionCatalog, input),
    reviewProjectDeletion: input => ipcRenderer.invoke(CHAT_CHANNEL.reviewProjectDeletion, input),
    resolveProjectDeletion: input => ipcRenderer.invoke(CHAT_CHANNEL.resolveProjectDeletion, input),
    retryProjectDeletion: input => ipcRenderer.invoke(CHAT_CHANNEL.retryProjectDeletion, input),
    recoveryPage: input => ipcRenderer.invoke(CHAT_CHANNEL.recoveryPage, input),
    recoveryFile: input => ipcRenderer.invoke(CHAT_CHANNEL.recoveryFile, input),
    onLocalChanged: changed => {
      const receive = (_event: IpcRendererEvent, event: { subscriptionId: string }) => { if (event.subscriptionId === "local") changed(); };
      ipcRenderer.on(CHAT_CHANNEL.changed, receive); return () => ipcRenderer.removeListener(CHAT_CHANNEL.changed, receive);
    },
    catalog: input => ipcRenderer.invoke(CHAT_CHANNEL.catalog, input),
    head: input => ipcRenderer.invoke(CHAT_CHANNEL.head, input),
    execution: input => ipcRenderer.invoke(CHAT_CHANNEL.execution, input),
    prepare: input => ipcRenderer.invoke(CHAT_CHANNEL.prepare, input),
    retryHome: input => ipcRenderer.invoke(CHAT_CHANNEL.retryHome, input),
    skipHome: input => ipcRenderer.invoke(CHAT_CHANNEL.skipHome, input),
    bindProject: input => ipcRenderer.invoke(CHAT_CHANNEL.bindProject, input),
    draft: input => ipcRenderer.invoke(CHAT_CHANNEL.draft, input),
    saveDraft: input => ipcRenderer.invoke(CHAT_CHANNEL.saveDraft, input),
    transcript: input => ipcRenderer.invoke(CHAT_CHANNEL.transcript, input),
    query: (name, input) => ipcRenderer.invoke(CHAT_CHANNEL.query, { name, input }),
    watch: (name, input, changed, failed) => {
      const subscriptionId = crypto.randomUUID(); let current = true;
      const receive = (_event: IpcRendererEvent, event: { subscriptionId: string; value?: unknown; error?: boolean; transient?: boolean }) => {
        if (!current || event.subscriptionId !== subscriptionId) return;
        if (event.error) failed(event.transient !== false); else changed(event.value as never);
      };
      ipcRenderer.on(CHAT_CHANNEL.changed, receive);
      void ipcRenderer.invoke(CHAT_CHANNEL.watch, { name, input, subscriptionId }).catch(() => { if (current) failed(true); });
      return () => { current = false; ipcRenderer.removeListener(CHAT_CHANNEL.changed, receive); void ipcRenderer.invoke(CHAT_CHANNEL.unwatch, { subscriptionId }).catch(() => {}); };
    },
    openFile: input => ipcRenderer.invoke(CHAT_CHANNEL.openFile, input),
    readFile: input => ipcRenderer.invoke(CHAT_CHANNEL.readFile, input),
    closeFile: input => ipcRenderer.invoke(CHAT_CHANNEL.closeFile, input),
  } satisfies CloudChatBridge);
}
