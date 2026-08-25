/**
 * [INPUT]: Depends on shared owner Key Analysis, BaseStoreFiles/AttachmentStore, canonical chat/project Identity and error text
 * [OUTPUT]: Provides loadBaseCorruptTombstones, validated v2 tombstone, cleared old chat generations and kept isolated from main project
 * [POS]: The base is damaged by the start of the family loader; The main Store only has a fail-closed Map and a normal state machine
 */

import { BASE_META_BYTE_LIMIT, ownerFromKey } from "../../../shared/bases-ipc";
import { errorMessage } from "../errors";
import type {
  BaseIdentity,
  CorruptTombstone,
} from "./base-store-model";
import type { BaseAttachmentStore } from "./store/attachments";
import {
  ownerFileStem,
  ownerKeyFromStem,
  type BaseStoreFiles,
} from "./store/base-files";

export async function loadBaseCorruptTombstones(input: {
  entries: Array<{ isFile(): boolean; name: string }>;
  chats: ReadonlyMap<string, BaseIdentity>;
  projectIds: ReadonlySet<string>;
  files: BaseStoreFiles;
  attachments: BaseAttachmentStore;
  corrupt: Map<string, CorruptTombstone>;
  now(): number;
  warn(message: string): void;
}) {
  const names = input.entries
    .filter(
      (entry) =>
        entry.isFile() &&
        /^(?:chat|project)-[A-Za-z0-9_-]{1,128}\.corrupt\.json$/.test(
          entry.name
        )
    )
    .map((entry) => entry.name)
    .sort();
  for (const name of names) {
    const ownerKey = ownerKeyFromStem(
      name.slice(0, -".corrupt.json".length)
    );
    const tombstone = await readTombstone(input, ownerKey);
    const ref = ownerFromKey(ownerKey);
    if (ref.kind === "project" && !input.projectIds.has(ref.projectId)) {
      await input.files.isolateFamily(ownerKey, input.now());
      input.warn(`损坏 Project Base ${ownerKey} 缺少 Project，已保守隔离`);
      continue;
    }
    if (ref.kind === "chat") {
      const chat = input.chats.get(ref.chatId);
      if (
        chat &&
        tombstone.ownerInstanceId &&
        tombstone.ownerInstanceId !== chat.incarnationId
      ) {
        await input.files.removeFamilyFiles(ownerKey);
        await input.attachments.releaseFamily(
          ownerFileStem(ownerKey),
          tombstone.ownerInstanceId,
          "deleted-proven"
        );
        continue;
      }
    }
    input.corrupt.set(ownerKey, tombstone);
    input.warn(`Base ${ownerKey} 保持 fail-closed`);
  }
}

async function readTombstone(
  input: Parameters<typeof loadBaseCorruptTombstones>[0],
  ownerKey: string
): Promise<CorruptTombstone> {
  try {
    const raw = JSON.parse(
      await input.files.readBounded(
        input.files.corruptPath(ownerKey),
        BASE_META_BYTE_LIMIT
      )
    ) as Partial<CorruptTombstone>;
    if (
      raw.ownerKey !== ownerKey ||
      (raw.ownerInstanceId !== null &&
        typeof raw.ownerInstanceId !== "string") ||
      (raw.backupName !== null && typeof raw.backupName !== "string") ||
      typeof raw.reason !== "string" ||
      typeof raw.quarantinedAt !== "number"
    ) {
      throw new Error("损坏墓碑结构无效");
    }
    return raw as CorruptTombstone;
  } catch (cause) {
    input.warn(`Base ${ownerKey} 的损坏墓碑不可解析，继续 fail-closed`);
    return {
      ownerKey,
      ownerInstanceId: null,
      backupName: null,
      reason: errorMessage(cause),
      quarantinedAt: input.now(),
    };
  }
}
