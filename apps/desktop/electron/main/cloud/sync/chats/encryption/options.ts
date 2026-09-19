/**
 * [INPUT]: Original option operations/checkpoints, admitted crypto and scoped encrypted Chat RPCs.
 * [OUTPUT]: Exact ciphertext replay and receipt-first recovery for original-domain option receipts after authenticated response checks.
 * [POS]: Incremental option adapter; the original outbox owns scheduling and retained byte custody.
 */
import { canonicalJson, protocolHeader, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import type { FileCipherPort } from "@ai-chat/cloud-protocol/blobs/encrypted";
import { frozenOptionsSchema } from "@ai-chat/cloud-protocol/chats/encrypted/options";
import { prepareEncryptedOptions, openEncryptedOptionsReceipt } from "@ai-chat/cloud-protocol/chats/encrypted/options/client";
import type { ChatOptionsOperation } from "@ai-chat/cloud-protocol/chats/options-sync";
import type { AccountTransport } from "../../../runtime/transport";
import type { ChatDeliveryCheckpoints } from "../checkpoints";
export async function publishEncryptedOptions(input: { config: CloudBuildConfig; userId: string; crypto(): FileCipherPort;
  transport: Pick<AccountTransport, "query" | "mutate">; current(): void }, operation: ChatOptionsOperation, checkpoints: ChatDeliveryCheckpoints, signal: AbortSignal) {
  const crypto = input.crypto(), header = { ...protocolHeader(input.config), expectedUserId: input.userId,
    encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } };
  const current = () => { signal.throwIfAborted(); input.current(); };
  current(); let frozenRaw = await checkpoints.get(`cipher-options:${operation.operationId}`); current();
  // Frozen ciphertext that predates this attempt is the only evidence that the apply may already have been received.
  const attempted = Boolean(frozenRaw);
  if (!frozenRaw) {
    const head = await input.transport.query("chats/metadata:head", { ...header, chatId: operation.chatId }); current();
    if (!head) throw new Error("CHAT_OPTIONS_HEAD_UNAVAILABLE");
    frozenRaw = await checkpoints.save(await prepareEncryptedOptions(operation, head, crypto, signal)); current();
  }
  const frozen = frozenOptionsSchema.parse(frozenRaw);
  if (frozen.plaintextHash !== operation.payloadHash || frozen.transport.operationId !== operation.operationId ||
    canonicalJson(frozen.encryptedSpace) !== canonicalJson(header.encryptedSpace)) throw new Error("OPTIONS_CIPHER_IDENTITY_MISMATCH");
  const receipt = (attempted ? await input.transport.query("chats/options:receipt", { ...header, operationId: operation.operationId }) : null) ??
    await input.transport.mutate("chats/options:apply", { ...header, operation: frozen.transport }); current();
  if (!receipt) return null;
  if (canonicalJson(receipt.commit) !== canonicalJson(frozen.transport)) throw new Error("OPTIONS_CIPHER_RECEIPT_MISMATCH");
  const result = await openEncryptedOptionsReceipt(receipt, crypto, signal); current();
  if (result.payloadHash !== operation.payloadHash) throw new Error("OPTIONS_CIPHER_RECEIPT_MISMATCH"); return result;
}
