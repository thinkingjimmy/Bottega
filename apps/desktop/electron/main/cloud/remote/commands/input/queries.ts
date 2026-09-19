/**
 * [INPUT]: Read-only workspace service, original command authority, private blob transfer and durable control receipts.
 * [OUTPUT]: Bounded encrypted workspace results with original receipt replay; query failures never start an Agent.
 * [POS]: Remote query adapter; only the descriptor crosses the small control-result envelope.
 */
import { protocolHeader, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import { remoteWorkspaceResultSchema } from "@ai-chat/cloud-protocol/remote/input/references";
import type { RemoteCommand } from "@ai-chat/cloud-protocol/remote/model";
import type { FrozenFileRecord, FrozenFileJournal } from "@ai-chat/cloud-protocol/blobs/encrypted/journal";
import type { RemoteContext } from "../../../../sections/coordinator/remote/model";
import type { RelayLedger } from "../../../../sections/coordinator/relay-ledger";
import { canonicalHash } from "../../../../sections/coordinator/coordinator-values";
import type { DesktopBlobStore } from "../../../files/store";
import { uploadChatBytes } from "../../../sync/chats/bodies";
import { controlReport } from "../actions";
import type { RemoteWorkspaceService } from "./references";
export async function applyRemoteWorkspaceQuery(command: RemoteCommand, context: RemoteContext, current: () => void, ports: {
  workspace: RemoteWorkspaceService; ledger: RelayLedger; config: CloudBuildConfig; files(): DesktopBlobStore;
  validate(): Promise<void>; own(activity: { close(): Promise<void> }): () => void;
}) {
  const payload = command.payload;
  if (payload.kind !== "list-workspace-files" && payload.kind !== "read-workspace-file") throw new Error("input-unsupported");
  const previous = ports.ledger.remote.control(command.commandId);
  if (previous) {
    if (canonicalHash(previous.remote) !== canonicalHash(context)) throw new Error("REMOTE_CONTROL_ID_CONFLICT");
    if (previous.state === "applied") return controlReport(previous);
  }
  await ports.validate(); current();
  const result = remoteWorkspaceResultSchema.parse(payload.kind === "list-workspace-files"
    ? await ports.workspace.list(command.chatId, payload.query, current) : await ports.workspace.read(command.chatId, payload.reference, current)); current();
  const bytes = new TextEncoder().encode(JSON.stringify(result));
  const source = { bytes: bytes.length, mime: "application/json", read: async (offset: number, length: number) => bytes.slice(offset, offset + length) };
  const records = new Map<string, FrozenFileRecord>(), journal: FrozenFileJournal = { read: async key => records.get(key) ?? null,
    write: async (key, value) => { const prior = records.get(key); if (prior) return prior; records.set(key, value); return value; } };
  const files = ports.files(), controller = new AbortController(), release = ports.own({ close: async () => { controller.abort(); await files.close(); } });
  try {
    await ports.validate(); current();
    const crypto = files.transfer.crypto, header = { ...protocolHeader(ports.config), expectedUserId: context.scope.userId,
      encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } };
    const blob = await uploadChatBytes({ files: files.transfer }, header, source, command.chatId, command.commandId, "message-overflow", controller.signal, journal); current();
    await ports.validate(); current();
    await ports.ledger.remote.reserveControl({ id: command.commandId, conversationId: context.chatId, incarnationId: context.incarnationId,
      requestId: command.commandId, generation: 1, key: `query:${command.commandId}`, payload, payloadHash: canonicalHash(payload), remote: context });
    return controlReport(await ports.ledger.remote.settleControl(command.commandId, "applied", { kind: "workspace-result", blob }));
  } finally { records.clear(); bytes.fill(0); await files.close(); release(); }
}
