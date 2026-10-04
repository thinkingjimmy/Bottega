/**
 * [INPUT]: Immutable message references and a bounded, membership-fenced batch RPC.
 * [OUTPUT]: An at-most-eight-MiB ciphertext prefetch with exact-prefix continuation and large-body fallback.
 * [POS]: SDK-free page reader shared by Web and desktop; every block is still authenticated by the message codec.
 */
import { MESSAGE_CIPHER_LIMITS, type EncryptedMessage, type EncryptedMessageBlock } from "./model";
import { encryptedMessageFunctions } from "./functions";
type Reference = { bodyHash: string; blockId: string };
export type MessageBlocksQuery = (blocks: Reference[], signal: AbortSignal) => Promise<{ blocks: EncryptedMessageBlock[]; complete: boolean }>;
const MAX_PREFETCH_BYTES = 8 * 1024 * 1024;

export async function prepareMessageBlockReader(messages: EncryptedMessage[], query: MessageBlocksQuery, signal: AbortSignal) {
  const references: Reference[] = [], cached = new Map<string, EncryptedMessageBlock>(); let bytes = 0;
  for (const message of messages) for (const page of message.pages) for (const block of page.metadata.blocks) {
    const size = Math.ceil(block.ciphertextBytes / 3) * 4 + 1024;
    if (bytes + size > MAX_PREFETCH_BYTES) continue;
    bytes += size; references.push({ bodyHash: message.bodyHash, blockId: block.blockId });
  }
  const read = async (requested: Reference[]) => {
    signal.throwIfAborted(); const result = encryptedMessageFunctions["chats/body/reads:blocks"].result.parse(await query(requested, signal));
    signal.throwIfAborted();
    if (result.blocks.length > requested.length || result.complete !== (result.blocks.length === requested.length) ||
      result.blocks.some((block, index) => block.blockId !== requested[index]?.blockId)) throw new Error("CHAT_BLOCK_BATCH_CHANGED");
    return result.blocks;
  };
  let next = 0;
  const lane = async () => {
    while (next < references.length) {
      const group = references.slice(next, next + MESSAGE_CIPHER_LIMITS.rangeItems); next += group.length;
      for (let offset = 0; offset < group.length;) {
        const blocks = await read(group.slice(offset));
        for (let index = 0; index < blocks.length; index++) cached.set(`${group[offset + index]!.bodyHash}:${blocks[index]!.blockId}`, blocks[index]!);
        offset += blocks.length;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, Math.ceil(references.length / MESSAGE_CIPHER_LIMITS.rangeItems)) }, lane));
  return async (bodyHash: string, blockId: string) => {
    signal.throwIfAborted(); const key = `${bodyHash}:${blockId}`, value = cached.get(key);
    if (value) { cached.delete(key); return value; }
    return (await read([{ bodyHash, blockId }]))[0]!;
  };
}
