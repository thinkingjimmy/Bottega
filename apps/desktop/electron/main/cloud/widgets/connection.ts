/**
 * [INPUT]: Depends on the shared account admission/epoch and activity fence, original authenticated file/metadata transports and lazy Widget workers.
 * [OUTPUT]: Provides one current-scope WidgetCloudPort with owned cancellation and no independent account connection or business queue.
 * [POS]: Deferred Cloud composition; ordinary startup and unapproved packages allocate no transfer or crypto worker here.
 */
import { EncryptedBlobTransfer } from "@ai-chat/cloud-protocol/blobs/encrypted/transport";
import type { BlobTransferPorts } from "@ai-chat/cloud-protocol";
import {
  accountScopeAdmission,
  type AdmissionPorts,
} from "../sync/account-config/admission";
import type { AccountTransport } from "../runtime/transport/transport";
import { WidgetPackagePublisher } from "./publisher";
import { WidgetCloudClient } from "./client";
import type { WidgetCloudPort } from "./ports";
type Ports = AdmissionPorts & {
  userData: string;
  transport: Pick<AccountTransport, "query" | "mutate" | "watchWidgetCatalog">;
  files(userId: string): BlobTransferPorts;
  own(activity: { close(): Promise<void> }): () => unknown;
  subscribe(listener: () => void): () => void;
};
export function createWidgetCloudConnection(ports: Ports): WidgetCloudPort {
  let closed = false;
  const activities = new Set<{ close(): Promise<void> }>();
  const available = () =>
    !closed && accountScopeAdmission(ports).kind === "admitted";
  const execute = async <T>(
    kind: "publish" | "read",
    signal: AbortSignal | undefined,
    run: (owner: WidgetPackagePublisher | WidgetCloudClient) => Promise<T>,
  ) => {
    const admitted = accountScopeAdmission(ports);
    if (closed || admitted.kind !== "admitted")
      throw new Error("WIDGET_CLOUD_UNAVAILABLE");
    const current = () => {
      const next = accountScopeAdmission(ports);
      return !closed && next.kind === "admitted" && next.key === admitted.key;
    };
    const input = {
      userData: ports.userData,
      scope: {
        environment: ports.config.environmentId,
        userId: admitted.crypto.session.userId,
      },
      crypto: ports.crypto,
      header: () => admitted.header,
      current,
      transport: ports.transport,
      files: new EncryptedBlobTransfer(
        ports.files(admitted.crypto.session.userId),
      ),
    };
    const owner =
        kind === "publish"
          ? new WidgetPackagePublisher(input)
          : new WidgetCloudClient(input),
      activity = { close: () => owner.close() };
    let detach = () => {},
      unsubscribe = () => {};
    try {
      detach = ports.own(activity) as () => void;
      activities.add(activity);
      unsubscribe = ports.subscribe(() => {
        if (!current())
          void owner
            .close()
            .catch((error) =>
              console.warn("[widgets] account cancellation failed", error),
            );
      });
      signal?.throwIfAborted();
      return await run(owner);
    } finally {
      unsubscribe();
      detach();
      activities.delete(activity);
      await owner.close();
    }
  };
  return {
    available,
    catalog:(cursor,signal)=>execute('read',signal,owner=>(owner as WidgetCloudClient).catalog(cursor,signal)),
    watchCatalog:(changed,failed)=>{
      const admitted=accountScopeAdmission(ports);if(closed||admitted.kind!=='admitted')throw new Error('WIDGET_CLOUD_UNAVAILABLE');
      let stopped=false,release=()=>{},detach=()=>{},unsubscribe=()=>{};
      const stop=()=>{if(stopped)return;stopped=true;release();unsubscribe();detach();activities.delete(activity);};
      const activity={close:async()=>stop()};
      try{
        detach=ports.own(activity)as()=>void;activities.add(activity);unsubscribe=ports.subscribe(()=>{const next=accountScopeAdmission(ports);if(closed||next.kind!=='admitted'||next.key!==admitted.key){stop();failed(new Error('WIDGET_DELIVERY_SCOPE_CHANGED'));}});
        if(!ports.transport.watchWidgetCatalog)throw new Error('WIDGET_CATALOG_UNAVAILABLE');
        release=ports.transport.watchWidgetCatalog(admitted.header,value=>{if(!stopped)changed(value.revision);},error=>{if(!stopped)failed(error);});
      }catch(error){stop();throw error;}return stop;
    },
    publish: (packet, signal) =>
      execute("publish", signal, (owner) =>
        (owner as WidgetPackagePublisher).publish(packet, signal),
      ),
    review: (request, signal) =>
      execute("read", signal, (owner) =>
        (owner as WidgetCloudClient).review(request, signal),
      ),
    download: (delivery, signal, progress) =>
      execute("read", signal, (owner) =>
        (owner as WidgetCloudClient).download(delivery, signal, progress),
      ),
    retire: (subject, operationId, signal) =>
      execute("read", signal, (owner) =>
        (owner as WidgetCloudClient).retire(subject, operationId, signal),
      ),
    close: async () => {
      closed = true;
      const result = await Promise.allSettled(
        [...activities].map((activity) => activity.close()),
      );
      const failure = result.find((value) => value.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    },
  };
}
