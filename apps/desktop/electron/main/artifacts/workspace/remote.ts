/**
 * [INPUT]: Account-fenced main crypto/transport, original Chat owner and the existing review checkpoint owner.
 * [OUTPUT]: Fresh mirror reads, ephemeral thumbnail cancellation and immutable resource mutations with durable same-record recovery.
 * [POS]: Reader-computer adapter; no local workspace authority, plugin state or automatic owner substitution.
 */
import { createHash } from "node:crypto";
import type { FileCipherPort } from "@ai-chat/cloud-protocol/blobs/encrypted";
import { openRemoteTargets } from "@ai-chat/cloud-protocol/remote/encrypted/creation";
import { encryptedRemoteTargetsSchema } from "@ai-chat/cloud-protocol/remote/encrypted/model";
import { prepareResourceCommand, openResourceResult } from "@ai-chat/cloud-protocol/resources/encrypted";
import { resourceReceiptSchema, type ResourceAction, type ResourceResultBody } from "@ai-chat/cloud-protocol/resources/model";
import { protocolHeader, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import type { WorkspaceCommand } from "@ai-chat/cloud-protocol/artifacts/design/model";
import type { AccountTransport } from "../../cloud/runtime/transport/transport";
import { artifactRuntime } from "../core/runtime";
import { artifactWorkspace } from "./runtime";
import { canonicalJson } from "@bottega/contracts/core/canonical-json";
export function remoteArtifactWorkspace(ports: { config: CloudBuildConfig; deviceId: string; crypto(): FileCipherPort;
  transport: Pick<AccountTransport, "query" | "mutate">; current(): void }) {
  const owner = async (input: WorkspaceCommand) => {
    ports.current(); const remote = artifactRuntime()?.remote;
    if (!remote) throw new Error("artifact-offline");
    const head = await remote.validate({ chatId: input.chatId, incarnationId: input.incarnationId, artifactId: input.artifactId ?? "catalog" });
    ports.current(); if (!head.ownerDeviceId || head.ownerDeviceId === ports.deviceId) throw new Error("artifact-owner-changed");
    return head.ownerDeviceId;
  };
  const execute = async (input: WorkspaceCommand, action: ResourceAction, value: unknown): Promise<ResourceResultBody> => {
    const targetDeviceId = await owner(input), crypto = ports.crypto(), identity = canonicalJson([crypto.session.userId, crypto.scope, crypto.keyPackageFingerprint]);
    const current = () => { ports.current(); if (identity !== canonicalJson([ports.crypto().session.userId, ports.crypto().scope, ports.crypto().keyPackageFingerprint])) throw new Error("artifact-account-changed"); };
    const header = { ...protocolHeader(ports.config), expectedUserId: crypto.session.userId, encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } };
    const scope = [input.chatId, input.incarnationId, identity, targetDeviceId], key = JSON.stringify([...scope, action, input.action, input.requestId]);
    const digest = createHash("sha256").update(canonicalJson(value)).digest("hex"), checkpoints = artifactWorkspace().checkpoints;
    const retain = action === "artifact-workspace" && !["capture-status", "operation-status", "system-diff", "resume-edit", "resolve-edit", "thumbnail", "cancel-thumbnail", "canvas-target"].includes(input.action);
    const stored = retain ? checkpoints.command(key) : null;
    if (stored && stored.digest !== digest) throw new Error("artifact-request-conflict");
    let sealed = stored?.sealed;
    if (!sealed) {
      const prepared = await prepareResourceCommand({ sourceDeviceId: ports.deviceId, targetDeviceId, resourceKind: "artifact", resourceId: input.chatId, action, input: value as never, now: Date.now() }, crypto);
      current(); sealed = retain ? await checkpoints.retainCommand(key, digest, prepared) : prepared;
    }
    current(); await ports.transport.mutate("resources/commands:submit", { ...header, command: sealed });
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      current();
      const result = await ports.transport.query("resources/commands:receipts", { ...header, commandIds: [sealed.commandId] }); current();
      const receipt = result.items.find(item => item.command.commandId === sealed!.commandId);
      if (receipt) {
        resourceReceiptSchema.parse(receipt);
        const { packet, ...command } = sealed;
        if (canonicalJson(receipt.command) !== canonicalJson({ ...command, ciphertextHash: packet.ciphertextHash })) throw new Error("artifact-result-identity");
        if (receipt.state === "unknown" || receipt.state === "expired") throw new Error("remote-unknown");
        if (receipt.state === "succeeded" || receipt.state === "refused") {
          const body = await openResourceResult(receipt, crypto); current();
          if (await owner(input) !== targetDeviceId) throw new Error("artifact-owner-changed");
          if (!body?.ok) { if (retain && body) await checkpoints.releaseCommand(key); throw new Error(body && !body.ok ? body.code : "artifact-unavailable"); }
          if (input.requestId && (body.artifactOperation?.status === "committed" || body.artifactOperation?.status === "conflict" && !body.artifactOperation.sourceConflict?.needsResolution)) await checkpoints.releaseRequest(scope, input.requestId);
          else if (retain && (body.artifactExport || body.artifactRecovery)) await checkpoints.releaseCommand(key);
          current(); return body;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error("remote-unknown");
  };
  return { execute, owner,
    async capability(input: WorkspaceCommand) {
      const targetDeviceId = await owner(input), crypto = ports.crypto(); let cursor: string | null = null;
      for (let page = 0; page < 8; page++) {
        const raw = await ports.transport.query("remote/capabilities:targets", { ...protocolHeader(ports.config), expectedUserId: crypto.session.userId,
          encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint }, chatId: input.chatId, cursor });
        const targets = await openRemoteTargets(encryptedRemoteTargetsSchema.parse(raw), crypto); ports.current();
        const target = targets.items.find(value => value.deviceId === targetDeviceId); if (target) return target;
        if (!targets.cursor) break; cursor = targets.cursor;
      }
      throw new Error("artifact-offline");
    },
  };
}
export type RemoteArtifactWorkspace = ReturnType<typeof remoteArtifactWorkspace>;
