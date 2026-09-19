/**
 * [INPUT]: Depends on trusted renderer IPC and fixed remote request/subscription schemas.
 * [OUTPUT]: Registers strict remote command and attachment upload IPC from the trusted main frame.
 * [POS]: Electron remote control guardian; no renderer can claim local intake authority.
 */
import { z } from "zod";
import type { BrowserWindow } from "electron";
import { rendererIpc } from "../../../ipc-registrar";
import { REMOTE_CHANNEL, remoteRequests, remoteWatchSchema, type RemoteMethod } from "../../../../../shared/cloud/remote/contracts";
import type { RemoteCommandClient } from "./client";
export function registerCloudRemote(client: RemoteCommandClient, window: BrowserWindow, rendererUrl: string) {
  const ipc = rendererIpc(rendererUrl, "Cloud remote control access denied").roles("main"), subscriptions = new Map<string, () => void>();
  const send = (subscriptionId: string, value?: unknown, error?: boolean) => {
    if (!window.isDestroyed()) window.webContents.send(REMOTE_CHANNEL.changed, { subscriptionId, value, error });
  };
  for (const method of Object.keys(remoteRequests) as RemoteMethod[]) ipc.handle(REMOTE_CHANNEL[method], (...args) => {
    const [input] = z.tuple([remoteRequests[method]]).parse(args); return client.call(method, input, (uploadId, progress) => {
      if (!window.isDestroyed()) window.webContents.send(REMOTE_CHANNEL.attachmentProgress, { uploadId, progress });
    });
  });
  ipc.handle(REMOTE_CHANNEL.watch, (...args) => {
    const [request] = z.tuple([remoteWatchSchema]).parse(args), id = request.subscriptionId;
    if (subscriptions.has(id) || subscriptions.size >= 12) throw new Error("REMOTE_SUBSCRIPTION_LIMIT");
    let stop = () => {}; subscriptions.set(id, () => stop());
    stop = client.watch(request.method, request.input, value => send(id, value), () => { subscriptions.delete(id); send(id, undefined, true); });
    if (!subscriptions.has(id)) stop();
  });
  ipc.handle(REMOTE_CHANNEL.unwatch, (...args) => {
    const [{ subscriptionId }] = z.tuple([z.object({ subscriptionId: z.string().uuid() }).strict()]).parse(args);
    subscriptions.get(subscriptionId)?.(); subscriptions.delete(subscriptionId);
  });
  window.webContents.once("destroyed", () => { for (const stop of subscriptions.values()) stop(); subscriptions.clear(); });
}
