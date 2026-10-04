/**
 * [INPUT]: Depends on trusted renderer IPC and fixed remote request/subscription schemas.
 * [OUTPUT]: Registers strict remote command and attachment upload IPC from the trusted main frame, answering a signed-out subscription instead of rejecting it; replies, watch values and progress are parsed against the remote contracts before they leave main.
 * [POS]: Electron remote control guardian; no renderer can claim local intake authority.
 */
import { z } from "zod";
import type { BrowserWindow } from "electron";
import { rendererIpc } from "../../../registration/ipc-registrar";
import { REMOTE_CHANNEL, remoteAttachmentProgressSchema, remoteRequests, remoteResults, remoteWatchSchema, type RemoteMethod } from "../../../../../shared/cloud/remote/contracts";
import { replying, reportOutboundDrift, sendParsed } from "../../replies";
import type { RemoteCommandClient } from "./client";
export function registerCloudRemote(client: RemoteCommandClient, window: BrowserWindow, rendererUrl: string) {
  const ipc = rendererIpc(rendererUrl, "Cloud remote control access denied").roles("main"), subscriptions = new Map<string, () => void>();
  const send = (subscriptionId: string, value?: unknown, error?: boolean) => {
    if (!window.isDestroyed()) window.webContents.send(REMOTE_CHANNEL.changed, { subscriptionId, value, error });
  };
  /* Replies, watch values and progress leave main in their contract's exact shape (OPT-34); preload carries no schemas. */
  for (const method of Object.keys(remoteRequests) as RemoteMethod[]) ipc.handle(REMOTE_CHANNEL[method], replying(remoteResults[method] as z.ZodType, (...args) => {
    const [input] = z.tuple([remoteRequests[method]]).parse(args); return client.call(method, input, (uploadId, progress) => {
      sendParsed(window, REMOTE_CHANNEL.attachmentProgress, remoteAttachmentProgressSchema, { uploadId, progress });
    });
  }));
  ipc.handle(REMOTE_CHANNEL.watch, (...args) => {
    const [request] = z.tuple([remoteWatchSchema]).parse(args), id = request.subscriptionId;
    if (subscriptions.has(id) || subscriptions.size >= 12) throw new Error("REMOTE_SUBSCRIPTION_LIMIT");
    /* Before sign-in the renderer still asks once; answering "not signed in" keeps that window out of the
       main log, and the renderer treats it exactly as it treats a dropped subscription (N-1 / AC-8). */
    if (!client.available()) return { kind: "signed-out" as const };
    let stop = () => {}; subscriptions.set(id, () => stop());
    /* A value outside the contract ends the subscription, as preload used to end it. */
    const result = remoteResults[request.method];
    stop = client.watch(request.method, request.input, value => {
      const parsed = result.safeParse(value); if (parsed.success) send(id, parsed.data); else { reportOutboundDrift(`${REMOTE_CHANNEL.changed}:${request.method}`, parsed.error); subscriptions.get(id)?.(); subscriptions.delete(id); send(id, undefined, true); }
    }, () => { subscriptions.delete(id); send(id, undefined, true); });
    if (!subscriptions.has(id)) stop();
    return { kind: "watching" as const };
  });
  ipc.handle(REMOTE_CHANNEL.unwatch, (...args) => {
    const [{ subscriptionId }] = z.tuple([z.object({ subscriptionId: z.string().uuid() }).strict()]).parse(args);
    subscriptions.get(subscriptionId)?.(); subscriptions.delete(subscriptionId);
  });
  window.webContents.once("destroyed", () => { for (const stop of subscriptions.values()) stop(); subscriptions.clear(); });
}
