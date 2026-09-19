/**
 * [INPUT]: Depends on BaseStoreFiles/BaseAttachmentStore, the strict Base meta schema, retained ciphertext roots, canonical chat identities and live Project ids
 * [OUTPUT]: Mounts complete current Base generations and detached candidate custody, records every departed or unreadable owner without moving its bytes, reloads one once its dependency reappears, collects stale generations and ciphertext, and preserves corrupt dependencies.
 * [POS]: The load half of bases/store; BaseStore keeps the queue, transactions and commits, this file only turns disk into memory
 */

import { readSync } from "./sync/files";
import { recoverOrDefer } from "../../persistence/recovery-policy";
import { describeIncompleteBase, type IncompleteBase } from "./folder/incomplete";
import { readBaseCiphertextRoots } from "./sync/encryption/generations";
import { syncAttachmentRoots, projectBase } from "./sync/projection";
import { canonicalJson } from "../../../../shared/local-storage/contracts";
import { mkdir, readdir } from "node:fs/promises";
import { type BaseMeta } from "../../../../shared/bases-ipc";
import { ownerKeyOf } from "@ai-chat/base-ui/model/owner-key";
import { errorMessage } from "../../errors";
import {
  storedBase,
  type BaseIdentity,
  type StoredBase,
  validateStoredBase,
} from "../base-store-model";
import type { BaseAttachmentStore } from "./attachments";
import {
  ownerFileStem,
  ownerKeyFromStem,
  type BaseStoreFiles,
} from "./base-files";
import { collectRowAttachmentBlobIds } from "./gallery-ledger";

export type StartupInput = {
  root: string;
  exportsRoot: string;
  files: BaseStoreFiles;
  attachments: BaseAttachmentStore;
  states: Map<string, StoredBase>;
  chats: ReadonlyMap<string, BaseIdentity>;
  projectIds: ReadonlySet<string>;
  now(): number;
};

/** Every owner the folder has a meta file for, in the one order a load may visit them. */
export async function listBaseOwnerKeys(root: string) {
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^(?:chat|project)-[A-Za-z0-9_-]{1,128}\.json$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .map((name) => ownerKeyFromStem(name.slice(0, -5)));
}

export async function initializeBaseStoreStartup(input: StartupInput) {
  await mkdir(input.root, { recursive: true, mode: 0o700 });
  await mkdir(input.files.syncRoot, { recursive: true, mode: 0o700 });
  await mkdir(input.exportsRoot, { recursive: true, mode: 0o700 });
  await recoverOrDefer(() => input.files.sweepTemporaryFiles());
  await input.attachments.initialize();
  input.states.clear();

  const failures = new Map<string, IncompleteBase>();
  for (const key of await listBaseOwnerKeys(input.root)) {
    try { await loadOwner(input, key, failures); }
    catch (error) {
      failures.set(key, await describeIncompleteBase(input.files, key)); console.warn("Base folder content unavailable", key, error);
    }
  }
  return failures;
}

/**
 * One owner, the same load. A Chat materialized after the window is the dependency a
 * `owner-incarnation-changed` or `project-missing` failure was missing; nothing else re-reads it
 * before the next launch. Returns the failure that still stands, or null once the owner is in `states`.
 */
export async function reloadBaseOwner(input: StartupInput, ownerKey: string) {
  const failures = new Map<string, IncompleteBase>();
  try { await loadOwner(input, ownerKey, failures); }
  catch (error) {
    failures.set(ownerKey, await describeIncompleteBase(input.files, ownerKey)); console.warn("Base folder content unavailable", ownerKey, error);
  }
  return failures.get(ownerKey) ?? null;
}

/** Missing dependencies remain visible and block replacement until an explicit recovery has complete evidence. */
async function loadOwner(input: StartupInput, ownerKey: string, failures: Map<string, IncompleteBase>) {
  let meta: BaseMeta;
  try {
    const stored = await input.files.readMetaIfPresent(ownerKey);
    if (!stored) throw new Error("BASE_CONTENT_MISSING");
    meta = stored;
    if (ownerKeyOf(meta.owner) !== ownerKey) {
      throw new Error("meta owner 与文件名不一致");
    }
  } catch (cause) {
    throw new Error(`Base ${ownerKey} cannot be opened; original files were preserved`, { cause });
  }
  const sync = await readSync(input.files, input.root, meta);
  if (!(await reconcileOwner(input, meta, sync.detachedCustody.length > 0, failures))) return;

  try {
    const rows = await input.files.readRows(meta);
    if (sync.confirmed && canonicalJson(projectBase(sync).rows) !== canonicalJson(rows)) throw new Error("Base rows and synchronization projection disagree");
    const gallery = await input.files.readGallery(meta);
    const history = await input.files.readHistory(meta);
    const rowsById = validateStoredBase(meta, rows, gallery, {
      meta: (value) => input.files.serializeMeta(value),
      rows: (value) => input.files.serializeRows(value),
      gallery: (value) => input.files.serializeGallery(value),
    });
    input.states.set(
      ownerKey,
      storedBase({ meta, rows, rowsById, gallery, history, sync,
        attachmentBlobIds: new Set([...collectRowAttachmentBlobIds(rows), ...syncAttachmentRoots(sync)]) })
    );
    await recoverOrDefer(async () => {
    const active = input.states.get(ownerKey);
    if (!active || active.meta.ownerInstanceId !== meta.ownerInstanceId || active.meta.revision !== meta.revision) return;
    await input.attachments.gcFamily(ownerFileStem(ownerKey), meta.ownerInstanceId, active.attachmentBlobIds);
    /* Retained generations are the only record of which frozen ciphertexts a resend still needs, so the
       roots are read before the old generations go; a superset simply keeps a record one launch longer. */
    const ciphertext = await readBaseCiphertextRoots(input.files, meta).then((value) => value.hashes).catch((cause) => {
      console.warn(`Base ${ownerKey} ciphertext retention unavailable: ${errorMessage(cause)}`); return null;
    });
    await input.files
      .gcGenerations(
        ownerKey,
        meta.rowsGeneration,
        meta.galleryGeneration,
        meta.historyGeneration,
        meta.syncGeneration
      )
      .catch((cause) =>
        console.warn(
          `Base ${ownerKey} 旧世代清理失败：${errorMessage(cause)}`
        )
      );
    if (ciphertext) {
      await input.files.gcCiphertext(ownerKey, ciphertext)
        .catch((cause) => console.warn(`Base ${ownerKey} ciphertext cleanup failed: ${errorMessage(cause)}`));
    }
    });
  } catch (cause) {
    input.states.delete(ownerKey);
    throw new Error(`Base ${ownerKey} recovery failed; original files were preserved`, { cause });
  }
}

/** true 表示 owner 仍然活着、可以继续加载。 */
async function reconcileOwner(input: StartupInput, meta: BaseMeta, detached: boolean, failures: Map<string, IncompleteBase>) {
  const ownerKey = ownerKeyOf(meta.owner);
  if (meta.owner.kind === "chat") {
    const chat = input.chats.get(meta.owner.chatId);
    if (!chat) {
      // Cleanup may remove a read-only Chat mirror while preserving its unsent Base edits.
      // The complete detached envelope owns those bytes without granting Chat execution.
      if (detached) return true;
      console.warn(`Base ${ownerKey} 的 Chat 状态未知，按 unknown 保留`);
      return false;
    }
    if (
      chat.incarnationId !== meta.owner.incarnationId ||
      chat.incarnationId !== meta.ownerInstanceId
    ) {
      /* The folder keeps the original bytes. Dropping the owner without a record is how a Base
         disappeared silently; the workbench needs an entry it can explain. */
      failures.set(ownerKey, { meta, files: [], reason: "owner-incarnation-changed" });
      console.warn("Base owner incarnation changed", ownerKey);
      return false;
    }
    return true;
  }
  if (input.projectIds.has(meta.owner.projectId)) return true;
  failures.set(ownerKey, { meta, files: [], reason: "project-missing" });
  console.warn("Base project record unavailable", ownerKey);
  return false;
}
