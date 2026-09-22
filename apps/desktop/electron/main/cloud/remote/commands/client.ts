/**
 * [INPUT]: Depends on authenticated account state, sync consent, closed CloudTransport methods and shared preparation rejection proof.
 * [OUTPUT]: Provides account-scoped remote commands and cancellable encrypted file staging with bounded IPC progress.
 * [POS]: Main-only remote client; source authority and all protocol headers are injected here.
 */
import { protocolHeader, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import { RemoteClientCodec } from "@ai-chat/cloud-protocol/remote/encrypted/session";
import type { RemoteCipherPort } from "@ai-chat/cloud-protocol/remote/encrypted/client";
import type { ServerClock } from "@ai-chat/cloud-protocol/continuity/clock";
import { ConvexError } from "convex/values";
import { preparationRejection, type PreparationRejection } from "@ai-chat/cloud-protocol/remote/selection";
import type { CloudTransport } from "../../runtime/transport";
import type { CloudAccountService } from "../../runtime/service";
import type { SyncBindingStore } from "../../sync/account/binding";
import type { RemoteInput, RemoteMethod, RemoteResult, RemoteWatch } from "../../../../../shared/cloud/remote/contracts";
import { remoteAttachmentUploader, type RemoteAttachmentPort } from "@ai-chat/chat-ui/remote-upload";
import type { DesktopBlobStore } from "../../files/store";
import type { FileProgress } from "@ai-chat/cloud-protocol";
export type RemoteClientPorts = { crypto(): RemoteCipherPort; clock(): ServerClock; config: CloudBuildConfig; deviceId: string; transport: Pick<CloudTransport, "query" | "mutate" | "watchRemote">;
  account: Pick<CloudAccountService, "snapshot">; binding: Pick<SyncBindingStore, "snapshot">; files?(userId: string): DesktopBlobStore;
  own(activity: { close(): Promise<void> }): () => void };
export class RemoteCommandClient {
  private uploadOwner: { identity: string; port: RemoteAttachmentPort; close(): Promise<void> } | null = null;
  private uploads = new Map<string, AbortController>();
  constructor(private readonly ports: RemoteClientPorts) {}
  private async execution<T>(run: () => Promise<T>): Promise<T | { rejected: PreparationRejection }> {
    try { return await run(); }
    catch (error) {
      // Generic IPC errors would lose the server's proof that this original operation did not commit.
      const rejected = error instanceof ConvexError ? preparationRejection(error) : null;
      if (rejected) return { rejected };
      throw error;
    }
  }
  /* The same sentence `identity` enforces, asked instead of thrown, so a subscription that cannot exist
     yet is answered rather than logged. Asking by trying keeps the rule in one place and also covers a
     crypto port that refuses to hand out a session while the account is locked. */
  available() { try { this.identity(); return true; } catch { return false; } }
  private identity() {
    const { account, binding, config, deviceId } = this.ports, user = account.snapshot(), local = binding.snapshot();
    if (user.status !== "ready" || !user.profile || user.deviceId !== deviceId || !local || local.phase !== "active" || local.paused ||
      local.userId !== user.profile.userId || local.deviceId !== deviceId) throw new Error("REMOTE_ACCOUNT_UNAVAILABLE");
    const crypto = this.ports.crypto();
    if (crypto.session.userId !== local.userId || crypto.session.deviceId !== deviceId) throw new Error("REMOTE_ACCOUNT_UNAVAILABLE");
    return { header: { ...protocolHeader(config), expectedUserId: local.userId, encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } },
      sessionId: crypto.session.sessionId, manifestId: local.manifestId };
  }
  private codec(identity: ReturnType<RemoteCommandClient["identity"]>) {
    return new RemoteClientCodec({ transport: this.ports.transport, header: protocolHeader(this.ports.config), crypto: this.ports.crypto, clock: this.ports.clock,
      current: () => { if (JSON.stringify(this.identity()) !== JSON.stringify(identity)) throw new Error("REMOTE_ACCOUNT_CHANGED"); } });
  }
  private attachmentPort(identity: ReturnType<RemoteCommandClient["identity"]>) {
    const key = JSON.stringify(identity);
    if (this.uploadOwner?.identity === key) return this.uploadOwner.port;
    void this.uploadOwner?.close().catch(() => {});
    const files = this.ports.files?.(identity.header.expectedUserId); if (!files) throw new Error("attachment-unavailable");
    const controller = new AbortController();
    const port = remoteAttachmentUploader(files.transfer, () => { if (JSON.stringify(this.identity()) !== key) throw new Error("REMOTE_ACCOUNT_CHANGED"); return identity.header; }, controller.signal);
    let release = () => {};
    const owner = { identity: key, port, close: async () => { controller.abort(); await files.close(); release(); if (this.uploadOwner === owner) this.uploadOwner = null; } };
    release = this.ports.own(owner); this.uploadOwner = owner; return port;
  }
  async call<N extends RemoteMethod>(method: N, value: RemoteInput<N>, progress?: (uploadId: string, value: FileProgress) => void): Promise<RemoteResult<N>> {
    const identity = this.identity(), { header } = identity, transport = this.ports.transport;
    const codec = this.codec(identity); let result: unknown;
    switch (method) {
      case "projectFiles": {
        const abort = new AbortController(), release = this.ports.own({ close: async () => { abort.abort(); } });
        try { result = await codec.projectFiles(value as RemoteInput<"projectFiles">, abort.signal); } finally { release(); } break;
      }
      case "queue": result = await transport.query("remote/queue:awaiting", { ...header, ...value as RemoteInput<"queue"> }); break;
      case "reorderQueue": result = await transport.mutate("remote/queue:reorderAwaiting", { ...header, ...value as RemoteInput<"reorderQueue"> }); break;
      case "cancelAttachment": { this.uploads.get((value as RemoteInput<"cancelAttachment">).uploadId)?.abort(); result = null; break; }
      case "stageAttachment": {
        const input = value as RemoteInput<"stageAttachment">;
        if (this.uploads.has(input.uploadId) || this.uploads.size >= 8) throw new Error("attachment-upload-busy");
        const controller = new AbortController(); this.uploads.set(input.uploadId, controller);
        try { result = await (await this.attachmentPort(identity)).stage({ chatId: input.chatId, attachmentId: input.attachmentId, uploadId: input.uploadId,
          file: new File([new Uint8Array(input.bytes)], input.filename, { type: input.mediaType }) }, controller.signal, value => progress?.(input.uploadId, value)); }
        finally { this.uploads.delete(input.uploadId); } break;
      }
      case "targets": result = { ...await codec.targets(await transport.query("remote/capabilities:targets", { ...header, ...value as RemoteInput<"targets"> })), localDeviceId: this.ports.deviceId }; break;
      case "command": { const raw = await transport.query("remote/commands:get", { ...header, ...value as RemoteInput<"command"> }); result = raw ? await codec.receipt(raw) : null; break; }
      case "withdraw": result = await codec.receipt(await transport.mutate("remote/commands:withdraw", { ...header, ...value as RemoteInput<"withdraw"> })); break;
      case "commands": result = await codec.page(await transport.query("remote/commands:page", { ...header, ...value as RemoteInput<"commands"> })); break;
      case "created": { const raw = await transport.query("remote/chats:created", { ...header, ...value as RemoteInput<"created"> }); result = raw ? await codec.creationReceipt(raw) : null; break; }
      case "prepareCommand": result = await codec.prepare(value as RemoteInput<"prepareCommand">); break;
      case "submit": { const input = value as RemoteInput<"submit">; result = await codec.submit(input.command, input.frozen); break; }
      case "prepareCreate": result = await codec.prepareCreate(value as RemoteInput<"prepareCreate">); break;
      case "create": { const input = value as RemoteInput<"create">; result = await codec.create(input.input, input.frozen); break; }
      case "retryPreparation": { const input = value as RemoteInput<"retryPreparation">;
        result = await this.execution(async () => codec.head(await transport.mutate("remote/chats:retryPreparation", { ...header, ...input }), input)); break; }
    }
    if (JSON.stringify(this.identity()) !== JSON.stringify(identity)) throw new Error("REMOTE_ACCOUNT_CHANGED");
    return result as RemoteResult<N>;
  }
  watch<N extends RemoteWatch>(method: N, input: RemoteInput<N>, changed: (value: RemoteResult<N>) => void, failed: () => void) {
    const identity = this.identity(), codec = this.codec(identity); let generation = 0, controller = new AbortController(); let active = true, unsubscribe = () => {}, disown = () => {};
    const release = () => { if (!active) return; active = false; generation++; controller.abort(); unsubscribe(); disown(); };
    const failure = () => { if (!active) return; release(); failed(); };
    disown = this.ports.own({ close: async () => failure() });
    const accept = (decode: (signal: AbortSignal) => Promise<unknown>) => {
      const revision = ++generation; controller.abort(); controller = new AbortController();
      void decode(controller.signal).then(value => {
        if (!active || revision !== generation) return;
        if (JSON.stringify(this.identity()) !== JSON.stringify(identity)) { failure(); return; } changed(value as RemoteResult<N>);
      }).catch(() => { if (active && revision === generation) failure(); });
    };
    try {
      const { header } = identity, transport = this.ports.transport;
      if (method === "targets") unsubscribe = transport.watchRemote("remote/capabilities:targets", { ...header, ...input as RemoteInput<"targets"> },
        value => accept(async signal => ({ ...await codec.targets(value, signal), localDeviceId: this.ports.deviceId })), failure);
      else if (method === "command") unsubscribe = transport.watchRemote("remote/commands:get", { ...header, ...input as RemoteInput<"command"> }, value => accept(signal => value ? codec.receipt(value, signal) : Promise.resolve(null)), failure);
      else if (method === "queue") unsubscribe = transport.watchRemote("remote/queue:awaiting", { ...header, ...input as RemoteInput<"queue"> }, value => accept(async () => value), failure);
      else unsubscribe = transport.watchRemote("remote/commands:page", { ...header, ...input as RemoteInput<"commands"> }, value => accept(signal => codec.page(value, signal)), failure);
    } catch { failure(); }
    if (!active) unsubscribe();
    return release;
  }
}
