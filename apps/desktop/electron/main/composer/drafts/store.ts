/**
 * [INPUT]: Depends on Node fs/path/crypto, zod, persistence durableReplaceFile/SerialQueue, a FileAuthorizationStore-shaped grant port, a workspace resolver,
 *          the current account identity, and the shared durable draft DTOs
 * [OUTPUT]: Provides ComposerDraftStore (load/save/removeChat, F-12), read-only queue identities for App impact and removeAccountComposerDrafts (account erase, called by the account cleanup step)
 * [POS]: Main's owner of durable composer drafts: one file per (account, Chat, incarnation) under userData/composer-drafts; file chips are recorded
 *        from main's own grants (path, device, inode) and granted again on restore only while the same file is at that path
 */

import { createHash } from "node:crypto";
import { lstat, readdir, readFile, rm, rmdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { AgentWorkspaceScope } from "../../../../shared/ipc/agent/agent-ipc";
import type { ComposerDraftKey, DurableComposerDraft, DurableQueueItem, LoadedComposerDraft, SaveComposerDraftInput } from "../../../../shared/composer/drafts-ipc";
import { durableReplaceFile, ensureDurableDirectory, isErrnoCode } from "../../persistence/durable-json";
import { SerialQueue } from "../../persistence/serial-queue";

export type ComposerDraftAccount = Readonly<{ environmentId: string; deploymentId: string; userId: string }>;
type GrantFacts = Readonly<{ path: string; name: string; mediaType: string; device: number; inode: number }>;
export type ComposerDraftPorts = Readonly<{
  grants: {
    inspect(fileRef: string, windowId: string): GrantFacts | null;
    authorize(input: { path: string; name: string; mediaType: string }, workspace: string, windowId: string): Promise<{ fileRef: string }>;
    release(fileRef: string): void;
  };
  resolveWorkspace(scope: AgentWorkspaceScope): string;
  /** null while signed out: those drafts live under "local" and no account erase touches them. */
  identity(): ComposerDraftAccount | null;
}>;

const ROOT = "composer-drafts";
const LOCAL = "local";
const MAX_BYTES = 4 * 1024 * 1024;
const STORED_REF = "stored";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 40);
const accountKey = (account: ComposerDraftAccount | null) =>
  account ? digest([account.environmentId, account.deploymentId, account.userId]) : LOCAL;

type FileNode = { id: string; type: "file"; ref: string; name: string; mediaType: string };
const isFileNode = (node: unknown): node is FileNode =>
  typeof node === "object" && node !== null && (node as FileNode).type === "file" && typeof (node as FileNode).id === "string" && typeof (node as FileNode).name === "string";
const nodes = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const storedFileSchema = z.object({
  path: z.string(), name: z.string(), mediaType: z.string(), device: z.number(), inode: z.number(), scope: z.custom<AgentWorkspaceScope>((value) => typeof value === "object" && value !== null),
});
const storedSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  draft: z.object({
    richValue: z.array(z.unknown()),
    unavailableAttachments: z.array(z.object({ id: z.string(), name: z.string() })),
    queue: z.object({ paused: z.boolean(), items: z.array(z.object({
      id: z.string(), richValue: z.array(z.unknown()), displayText: z.string(), imageNames: z.array(z.string()).optional(), content: z.unknown().optional(),
      custodyIntentId: z.string().optional(), outboxRef: z.string().optional(), state: z.enum(["queued", "ambiguous"]),
      unavailableAttachment: z.string().optional(), createdAt: z.number(),
    })) }),
    pendingAcks: z.array(z.object({ kind: z.enum(["manual", "steer"]), id: z.string() })),
    workspaceIdentityKey: z.string(),
    projectId: z.string().nullable(),
  }),
  files: z.record(z.string(), storedFileSchema),
});
type Stored = z.infer<typeof storedSchema>;
type StoredFile = z.infer<typeof storedFileSchema>;

/** Erases one account's drafts (account switch or deletion). Idempotent; an absent store is success; a real I/O failure throws so the step retries. */
export async function removeAccountComposerDrafts(userData: string, account: ComposerDraftAccount) {
  await rm(join(userData, ROOT, accountKey(account)), { recursive: true, force: true });
}

export class ComposerDraftStore {
  private readonly queue = new SerialQueue();
  constructor(private readonly userData: string, private readonly ports: ComposerDraftPorts) {}

  private pathOf(key: ComposerDraftKey) {
    return join(this.userData, ROOT, accountKey(this.ports.identity()), digest(key.chatId), `${digest(key.incarnationId)}.json`);
  }

  queued(key: ComposerDraftKey) {
    return this.queue.enqueue(async () => {
      const stored = await readStored(this.pathOf(key));
      return stored?.draft.queue.items.map(item => ({ id: item.id, custodyIntentId: item.custodyIntentId })) ?? [];
    });
  }

  load(windowId: string, key: ComposerDraftKey): Promise<LoadedComposerDraft> {
    return this.queue.enqueue(async () => {
      const path = this.pathOf(key);
      await dropSiblings(path);
      const stored = await readStored(path);
      if (!stored) return { revision: 0, draft: null };
      const unavailable = [...stored.draft.unavailableAttachments];
      const grantAgain = async (value: unknown[], lost: (node: FileNode) => void) => {
        const out: unknown[] = [];
        for (const node of value) {
          if (!isFileNode(node)) { out.push(node); continue; }
          const file = stored.files[node.id];
          const fileRef = file ? await this.grantAgain(file, windowId) : null;
          if (fileRef) out.push({ ...node, ref: fileRef });
          else lost(node);
        }
        return out;
      };
      const richValue = await grantAgain(stored.draft.richValue, (node) => unavailable.push({ id: node.id, name: node.name }));
      const items: DurableQueueItem[] = [];
      for (const item of stored.draft.queue.items) {
        let held = item.unavailableAttachment ?? item.imageNames?.[0];
        const itemRichValue = await grantAgain(item.richValue, (node) => { held ??= node.name; });
        items.push({ ...item, richValue: itemRichValue, ...(held ? { unavailableAttachment: held } : {}) });
      }
      return { revision: stored.revision, draft: { ...stored.draft, richValue, unavailableAttachments: unavailable, queue: { ...stored.draft.queue, items } } };
    });
  }

  save(windowId: string, input: SaveComposerDraftInput): Promise<{ revision: number }> {
    return this.queue.enqueue(async () => {
      const path = this.pathOf(input);
      await dropSiblings(path);
      const previous = await readStored(path);
      if (previous && input.baseRevision !== previous.revision) throw new Error("COMPOSER_DRAFT_CHANGED");
      const revision = (previous?.revision ?? input.baseRevision) + 1;
      if (!input.draft) {
        await rm(path, { force: true });
        await pruneEmpty(dirname(path));
        return { revision };
      }
      const files: Record<string, StoredFile> = {};
      const record = (value: unknown, lost: (node: FileNode) => void) => nodes(value).flatMap((node) => {
        if (!isFileNode(node)) return [node];
        const facts = this.ports.grants.inspect(node.ref, windowId);
        const scope = input.fileScopes[node.ref];
        const earlier = previous?.files[node.id];
        // Only main's own grant counts; a grant that expired keeps what an earlier save recorded for the same chip.
        const file = facts && scope && facts.name === node.name ? { ...facts, scope } : earlier?.name === node.name ? earlier : null;
        if (!file) { lost(node); return []; }
        files[node.id] = file;
        return [{ ...node, ref: STORED_REF }];
      });
      const unavailable = [...input.draft.unavailableAttachments];
      const richValue = record(input.draft.richValue, (node) => unavailable.push({ id: node.id, name: node.name }));
      const items = input.draft.queue.items.map((item) => {
        let held = item.unavailableAttachment;
        const itemRichValue = record(item.richValue, (node) => { held ??= node.name; });
        return { ...item, richValue: itemRichValue, ...(held ? { unavailableAttachment: held } : {}) };
      });
      const draft: DurableComposerDraft = { ...input.draft, richValue, unavailableAttachments: unavailable, queue: { ...input.draft.queue, items } };
      const text = JSON.stringify(storedSchema.parse({ version: 1, revision, draft, files }));
      if (Buffer.byteLength(text) > MAX_BYTES) throw new Error("COMPOSER_DRAFT_TOO_LARGE");
      await ensureDurableDirectory(dirname(path));
      await durableReplaceFile(path, text);
      return { revision };
    });
  }

  /** A deleted Chat takes its drafts with it, under every account on this computer. */
  removeChat(chatId: string) {
    return this.queue.enqueue(async () => {
      const root = join(this.userData, ROOT);
      const accounts = await readdir(root).catch((cause) => { if (isErrnoCode(cause, "ENOENT")) return []; throw cause; });
      for (const account of accounts) await rm(join(root, account, digest(chatId)), { recursive: true, force: true });
    });
  }

  async close() { this.queue.close(); await this.queue.flush(); }

  private async grantAgain(file: StoredFile, windowId: string) {
    try {
      const { fileRef } = await this.ports.grants.authorize({ path: file.path, name: file.name, mediaType: file.mediaType }, this.ports.resolveWorkspace(file.scope), windowId);
      const now = this.ports.grants.inspect(fileRef, windowId);
      // Same name is not enough: a different file now at the path is never granted in its place.
      if (now?.device === file.device && now.inode === file.inode) return fileRef;
      this.ports.grants.release(fileRef);
      return null;
    } catch {
      return null;
    }
  }
}

async function readStored(path: string): Promise<Stored | null> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > MAX_BYTES) return null;
    return storedSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (cause) {
    if (isErrnoCode(cause, "ENOENT") || cause instanceof SyntaxError || cause instanceof z.ZodError) return null;
    throw cause;
  }
}

/** A new incarnation replaces the Chat's draft: any other incarnation's file in the same Chat directory goes. */
async function dropSiblings(path: string) {
  const directory = dirname(path), own = path.slice(directory.length + 1);
  const entries = await readdir(directory).catch((cause) => { if (isErrnoCode(cause, "ENOENT")) return []; throw cause; });
  for (const entry of entries) if (entry !== own) await rm(join(directory, entry), { recursive: true, force: true });
}

async function pruneEmpty(directory: string) {
  await rmdir(directory).catch(() => undefined);
}
