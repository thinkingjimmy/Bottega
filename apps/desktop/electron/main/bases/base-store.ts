/**
 * [INPUT]: Depends on owner-aware Base schemas, durable generations, stable tool provenance, attachment/startup leaves and SerialQueue.
 * [OUTPUT]: Single owner-key Base writer for snapshots, synchronization envelopes, original Agent receipts, identity recovery copies, deferred reloads of owners an absent Chat or Project held back, confirmed navigation, transfers, image-cache admission and on-screen read evidence for cloud subscriptions.
 * [POS]: Durable Base authority rooted in the selected folder; lifecycle services classify visibility here while renderer projections only consume summaries
 */
import { BaseSyncApi } from "./store/sync/api";
import { publishCandidateCopy } from "./store/sync/candidates/copy";
import { recoverInitialIdentity } from "./store/sync/identity/recovery";
import { repairIncompleteBase, type BaseRepairProof, type IncompleteBase } from "./store/folder/incomplete";
import { prepareTool, replayTool, toolEvidence } from "./store/tool/kernel";
import type { BaseToolIdentity } from "./store/tool/model";
import { emptyBaseSync, type BaseSyncEnvelope } from "./store/sync/model";
import { enqueueBaseMutation } from "./store/sync/queue";
import { syncAttachmentRoots } from "./store/sync/projection";
import { readSync, serializeSync, syncPath } from "./store/sync/files";
import { join } from "node:path";
import { BASE_OWNER_KEY_PATTERN, type BaseMeta, type BaseRow, type BaseSnapshot } from "../../../shared/bases-ipc";
import { ownerKeyOf } from "@ai-chat/base-ui/model/owner-key";
import type { BaseNavigation } from "../../../shared/placement/facts";
import {
  baseMetaSchema,
  baseRowSchema,
} from "../../../shared/bases-schema";
import type { BaseGalleryLedger } from "../../../shared/bases/gallery-attachments";
import type { BaseHistoryLedger } from "../../../shared/bases/history-ledger-schema";
import { errorMessage } from "../errors";
import { SerialQueue } from "../persistence/serial-queue";
import { BaseAttachmentStore } from "./store/attachments";
import { BaseStoreFiles, galleryOwnerId, ownerFileStem } from "./store/base-files";
import {
  collectRowAttachmentBlobIds,
  deriveGalleryRemovals,
  emptyGalleryLedger,
  galleryCanLoseEntries,
  parseGalleryLedger,
  validateGalleryLedger,
} from "./store/gallery-ledger";
import {
  appendHistoryEntry,
  createHistoryEntry,
  emptyHistoryLedger,
  historyForRow,
} from "./store/history-ledger";
import { BasePromotionApi } from "./store/promotion/api";
import type { RemoteBasePromotion } from "./store/promotion/remote";
import { type ConfirmedBasePromotion } from "./store/promotion/cloud";
import { initializeBaseStoreStartup, listBaseOwnerKeys, reloadBaseOwner } from "./store/startup";
import { libraryDirectory } from "../library/paths";
import {
  ALL_ROWS_CHANGED,
  NO_ROWS_CHANGED,
  BaseConflictError,
  BaseIncarnationError,
  BaseNotFoundError,
  chatOwnerIdentity,
  mutationTouchesRows,
  projectOwnerIdentity,
  sameJson,
  storedBase,
  validateBaseShape,
  validateStoredRows,
  type BaseIdentity,
  type BaseMutationRowIds,
  type BaseOwnerIdentity,
  type BaseStoreDependencies,
  type BaseStoreMutation,
  type IndexedBaseSnapshot,
  type ReadonlyBaseSnapshot,
  type StoredBase,
} from "./base-store-model";
import {
  navigationMutation,
  projectBaseSummaries,
  rootBaseSummaries,
} from "./navigation/store-projection";
export {
  BaseConflictError,
  BaseIncarnationError,
  BaseNotFoundError,
  chatOwnerIdentity,
  projectOwnerIdentity,
};
export { ALL_ROWS_CHANGED, NO_ROWS_CHANGED };
export type {
  BaseIdentity,
  BaseMutationRowIds,
  BaseOwnerIdentity,
  BaseStoreDependencies,
  BaseStoreMutation,
  IndexedBaseSnapshot,
  ReadonlyBaseSnapshot,
};
const NO_BLOBS: ReadonlySet<string> = new Set<string>();
/* How long a renderer read keeps a Base "on screen" for cloud synchronization. Two live Convex
   subscriptions per Base are only worth holding while a window is actually showing it. */
const SURFACE_WINDOW_MS = 10 * 60_000;
export class BaseStore {
  readonly sync: BaseSyncApi;
  private readonly blockedOwners = new Set<string>();
  private incompleteOwners = new Map<string, IncompleteBase>();
  /** Bases live in the folder and nowhere else; nothing may be read or written before one is selected. */
  get root() { const root = this.dependencies.libraryRoot(); if (!root) throw new Error("LIBRARY_NOT_CONFIGURED"); return join(root, "bases"); }
  /** CSV exports are this computer's scratch output, not Base content, so they stay beside the profile. */
  readonly exportsRoot: string;
  readonly attachments: BaseAttachmentStore;
  private readonly queue = new SerialQueue();
  private readonly states = new Map<string, StoredBase>();
  private readonly files: BaseStoreFiles;
  private readonly promotion: BasePromotionApi;
  private readonly now: () => number;
  private readonly surfaceReads = new Map<string, number>();
  private readonly surfaceListeners = new Set<(ownerKey: string, ownerInstanceId: string) => void>();
  constructor(
    userData: string,
    private readonly dependencies: BaseStoreDependencies
  ) {
    /* The directory layout is a fait accompli of existing data: the bases/exports path bytes cannot move. */
    this.exportsRoot = join(userData, "bases", "exports");
    this.attachments = new BaseAttachmentStore(() => this.root);
    this.now = dependencies.now ?? Date.now;
    this.sync = new BaseSyncApi({ queue: this.queue, attachments: this.attachments,
      files: { readCiphertext: (key, hash) => this.files.readCiphertext(key, hash), writeCiphertext: (key, content) => this.files.writeCiphertext(key, content) },
      state: (key, id) => this.requireState(key, id),
      scopes: () => [...this.states.values()].map(state => state.sync.scope ?? state.sync.initialCiphertext?.scope ?? null),
      states: () => this.states.values(),
      publishCopy: plan => publishCandidateCopy({ states: this.states, files: this.files, attachments: this.attachments }, plan),
      recoverIdentity: (source, plan, confirmed, tombstones) => recoverInitialIdentity({ states: this.states, files: this.files,
        attachments: this.attachments, block: key => this.blockedOwners.add(key) }, source, plan, confirmed, tombstones),
      commit: (key, id, envelope, snapshot) => {
        const state = this.requireState(key, id);
        return this.commitLocked(key, id, {
          meta: { ...(snapshot?.meta ?? state.meta), owner: state.meta.owner, ownerInstanceId: id, revision: state.meta.revision + 1 },
          rows: snapshot?.rows ?? state.rows, changedRowIds: snapshot ? ALL_ROWS_CHANGED : NO_ROWS_CHANGED,
          operation: "sync-reconcile",
        }, envelope);
      },
    }, dependencies.storageMode);
    this.files = new BaseStoreFiles(() => this.root, {
      syncRoot: join(userData, "bases-sync"),
      folderCheckpoint: dependencies.folderCheckpoint,
      readText: dependencies.readText,
      atomicWrite: dependencies.atomicWrite,
    });
    this.promotion = new BasePromotionApi({ queue: this.queue, states: this.states, files: this.files, attachments: this.attachments,
      requireState: (key, id) => this.requireState(key, id), remove: (key, id) => this.removeLocked(key, id),
      commitSync: (key, source, envelope) => this.commitLocked(key, source.meta.ownerInstanceId, {
        meta: { ...source.meta, revision: source.meta.revision + 1 }, rows: source.rows, changedRowIds: NO_ROWS_CHANGED, operation: "sync-reconcile",
      }, envelope) });
  }
  async initialize(
    chats: ReadonlyMap<string, BaseIdentity>,
    projectIds: ReadonlySet<string> = new Set()
  ) {
    await this.queue.enqueue(async () => {
      const root = this.dependencies.libraryRoot();
      /* Onboarding has not selected a folder yet; the first selection mounts every store again. */
      if (!root) return;
      await libraryDirectory(root, "bases");
      const failures = await initializeBaseStoreStartup({
        root: this.root,
        exportsRoot: this.exportsRoot,
        files: this.files,
        attachments: this.attachments,
        states: this.states,
        chats,
        projectIds,
        now: this.now,
      });
      this.blockedOwners.clear();
      this.incompleteOwners = failures;
      for (const key of failures.keys()) this.blockedOwners.add(key);
    });
  }
  /**
   * A departed owner is only departed against the identities startup could see. Deferred Chat
   * materialization changes that set, so every owner an absent dependency kept out of `states` gets
   * the same load again — the two recorded failure reasons, plus the owners a missing Chat identity
   * dropped without a record at all. One at a time, on the same queue; a healthy state is never
   * touched, and an owner whose dependency is still gone keeps exactly the entry it had.
   */
  reloadIncompleteOwners(chats: ReadonlyMap<string, BaseIdentity>, projectIds: ReadonlySet<string> = new Set()) {
    return this.queue.enqueue(async () => {
      if (!this.dependencies.libraryRoot()) return [];
      const pending = new Set([...this.incompleteOwners].filter(([, failure]) =>
        failure.reason === "owner-incarnation-changed" || failure.reason === "project-missing").map(([ownerKey]) => ownerKey));
      for (const ownerKey of await listBaseOwnerKeys(this.root).catch(() => [])) {
        if (!this.states.has(ownerKey) && !this.incompleteOwners.has(ownerKey)) pending.add(ownerKey);
      }
      const recovered: Array<{ ownerKey: string; snapshot: BaseSnapshot }> = [];
      for (const ownerKey of pending) {
        const failure = await reloadBaseOwner({ root: this.root, exportsRoot: this.exportsRoot, files: this.files,
          attachments: this.attachments, states: this.states, chats, projectIds, now: this.now }, ownerKey)
          .catch((cause) => { console.warn(`Base ${ownerKey} reload failed: ${errorMessage(cause)}`); return undefined; });
        const state = this.states.get(ownerKey);
        if (!state) { if (failure) this.incompleteOwners.set(ownerKey, failure); continue; }
        this.incompleteOwners.delete(ownerKey); this.blockedOwners.delete(ownerKey);
        recovered.push({ ownerKey, snapshot: this.snapshot(state) });
      }
      return recovered;
    });
  }
  /* Surface evidence, not durable state: the renderer and App-window read paths report here, and cloud
     synchronization only ever asks. `sync.read`, `listAll` and every internal lookup stay silent, so a Base
     nothing is showing decays to idle and loses its subscriptions. */
  noteSurfaceRead(ownerKey: string, ownerInstanceId: string) {
    const key = `${ownerKey}/${ownerInstanceId}`, now = this.now();
    const idle = now - (this.surfaceReads.get(key) ?? 0) > SURFACE_WINDOW_MS;
    this.surfaceReads.set(key, now);
    if (this.surfaceReads.size > 256) for (const [entry, at] of this.surfaceReads) if (now - at > SURFACE_WINDOW_MS) this.surfaceReads.delete(entry);
    if (idle) for (const listener of this.surfaceListeners) listener(ownerKey, ownerInstanceId);
  }
  onSurfaceRead(listener: (ownerKey: string, ownerInstanceId: string) => void) {
    this.surfaceListeners.add(listener);
    return () => { this.surfaceListeners.delete(listener); };
  }
  surfaced(ownerKey: string, ownerInstanceId: string) {
    const at = this.surfaceReads.get(`${ownerKey}/${ownerInstanceId}`);
    return at !== undefined && this.now() - at <= SURFACE_WINDOW_MS;
  }
  /** 唯一查表面：在册即状态，不在册即 null。没有第三种存在方式。 */
  get(ownerKey: string, ownerInstanceId?: string): BaseSnapshot | null {
    const state = this.lookup(ownerKey, ownerInstanceId);
    return state && this.snapshot(state);
  }
  peek(ownerKey: string, ownerInstanceId?: string): IndexedBaseSnapshot | null {
    return this.lookup(ownerKey, ownerInstanceId);
  }
  async describeQuerySnapshot(ownerKey: string, ownerInstanceId?: string) {
    const state = this.lookup(ownerKey, ownerInstanceId);
    if (!state) return null;
    return {
      baseInstanceId: state.meta.ownerInstanceId,
      revision: state.meta.revision,
      expectedRowsBytes: await this.files.rowsBytes(state.meta),
    };
  }
  copyQuerySnapshot(input: {
    ownerKey: string;
    baseInstanceId: string;
    revision: number;
  }) {
    this.assertOwnerKey(input.ownerKey);
    const state = this.states.get(input.ownerKey);
    const changed = !state || state.meta.ownerInstanceId !== input.baseInstanceId ||
      state.meta.revision !== input.revision;
    if (changed) {
      throw new BaseConflictError("Base query snapshot revision changed before copy");
    }
    return this.snapshot(state);
  }
  /** 全量只读枚举（search 扫描源）；提交是整对象替换，引用无需克隆即版本一致。 */
  listAll(): Array<{ ownerKey: string; snapshot: IndexedBaseSnapshot }> {
    return [...this.states.entries()].map(([ownerKey, snapshot]) => ({
      ownerKey,
      snapshot,
    }));
  }
  listRootBases() {
    return rootBaseSummaries([...this.states.values(), ...this.incompleteMetadata()]);
  }
  listProjectBases() {
    return projectBaseSummaries([...this.states.values(), ...this.incompleteMetadata()]);
  }
  private incompleteMetadata() { return [...this.incompleteOwners.values()].flatMap(item => item.meta ? [{ meta: item.meta }] : []); }
  incomplete(ownerKey: string) { return structuredClone(this.incompleteOwners.get(ownerKey) ?? null); }
  async incompleteEnvelope(ownerKey: string) {
    const meta = this.incompleteOwners.get(ownerKey)?.meta;
    return meta ? readSync(this.files, this.root, meta) : null;
  }
  repairIncomplete(ownerKey: string, proof: BaseRepairProof, current: () => void) {
    return this.queue.enqueue(async () => {
      const original = this.incompleteOwners.get(ownerKey); if (!original) throw new Error("BASE_FOLDER_REPAIR_CHANGED");
      const state = await repairIncompleteBase(this.files, ownerKey, original, proof, current);
      this.states.set(ownerKey, state); this.incompleteOwners.delete(ownerKey); this.blockedOwners.delete(ownerKey);
      return this.snapshot(state);
    });
  }
  setNavigation(
    ownerKey: string,
    navigation: BaseNavigation
  ): Promise<BaseSnapshot> {
    const state = this.states.get(ownerKey);
    if (!state) throw new BaseNotFoundError("Base does not exist");
    return this.transact(ownerKey, state.meta.ownerInstanceId, (current) =>
      navigationMutation(current, navigation)
    );
  }
  ensure(identity: BaseOwnerIdentity | BaseIdentity): Promise<BaseSnapshot> {
    const ownerIdentity =
      "owner" in identity ? identity : chatOwnerIdentity(identity);
    return this.queue.enqueue(() => this.ensureLocked(ownerIdentity));
  }
  createArtifact(identity: BaseOwnerIdentity, seed: { columns: BaseMeta["columns"]; rows: BaseRow[] }): Promise<BaseSnapshot> {
    return this.queue.enqueue(() => {
      if (this.states.has(ownerKeyOf(identity.owner))) throw new BaseConflictError("Base already exists");
      return this.ensureLocked(identity, seed);
    });
  }
  transact(
    ownerKey: string,
    ownerInstanceId: string,
    mutate: (current: BaseSnapshot) => BaseStoreMutation | null
  ): Promise<BaseSnapshot> {
    return this.queue.enqueue(async () => {
      const current = this.snapshot(
        this.requireState(ownerKey, ownerInstanceId)
      );
      const mutation = mutate(current);
      return mutation
        ? this.commitLocked(ownerKey, ownerInstanceId, mutation)
        : current;
    });
  }
  transactTool(ownerKey: string, ownerInstanceId: string, identity: BaseToolIdentity,
    mutate: (current: BaseSnapshot) => BaseStoreMutation | null) {
    return this.queue.enqueue(async () => {
      const state = this.requireState(ownerKey, ownerInstanceId);
      const existing = replayTool(state, identity);
      if (existing) return { snapshot: this.snapshot(state), receipt: existing, sync: toolEvidence(state.sync, identity.operationId), replayed: true };
      let mutation: BaseStoreMutation | null = null;
      let rejection: { status: "rejected" | "conflicted"; reason: string } | null = null;
      try {
        if (state.sync.tombstones.includes("base")) throw Object.assign(new Error("Base was deleted"), { status: 404, code: "deleted" });
        mutation = mutate(this.snapshot(state));
      }
      catch (cause) {
        const error = cause as { status?: number; code?: string };
        if (![400, 404, 409, 413].includes(error.status ?? 0)) throw cause;
        rejection = { status: error.status === 409 ? "conflicted" : "rejected", reason: error.code ?? "invalid_mutation" };
      }
      mutation ??= { meta: { ...state.meta, revision: state.meta.revision + 1 }, rows: state.rows,
        changedRowIds: NO_ROWS_CHANGED, actor: "agent", operation: "tool-result" };
      let prepared;
      try { prepared = prepareTool(state, mutation, identity, rejection); }
      catch (cause) {
        const error = cause as { status?: number; code?: string };
        if (![400, 404, 409, 413].includes(error.status ?? 0)) throw cause;
        mutation = { meta: { ...state.meta, revision: state.meta.revision + 1 }, rows: state.rows,
          changedRowIds: NO_ROWS_CHANGED, actor: "agent", operation: "tool-result" };
        prepared = prepareTool(state, mutation, identity, { status: error.status === 409 ? "conflicted" : "rejected", reason: error.code ?? "invalid_mutation" });
      }
      const { envelope, receipt } = prepared;
      const snapshot = await this.commitLocked(ownerKey, ownerInstanceId, mutation, envelope);
      return { snapshot, receipt, sync: toolEvidence(envelope, identity.operationId), replayed: false };
    });
  }
  transactGallery<T>(
    ownerKey: string,
    ownerInstanceId: string,
    mutate: (current: {
      snapshot: BaseSnapshot;
      gallery: BaseGalleryLedger;
    }) => Promise<{ mutation: BaseStoreMutation | null; result: T } | null>
  ): Promise<{ snapshot: BaseSnapshot; result: T | null }> {
    return this.queue.enqueue(async () => {
      const state = this.requireState(ownerKey, ownerInstanceId);
      const current = {
        snapshot: this.snapshot(state),
        gallery: structuredClone(state.gallery),
      };
      const changed = await mutate(current);
      if (!changed) return { snapshot: current.snapshot, result: null };
      if (!changed.mutation) {
        return { snapshot: current.snapshot, result: changed.result };
      }
      const snapshot = await this.commitLocked(
        ownerKey,
        ownerInstanceId,
        changed.mutation
      );
      return { snapshot, result: changed.result };
    });
  }
  gallery(ownerKey: string, ownerInstanceId: string) {
    return structuredClone(this.requireState(ownerKey, ownerInstanceId).gallery);
  }
  rowHistory(ownerKey: string, ownerInstanceId: string, rowId: string) {
    return structuredClone(
      historyForRow(
        this.requireState(ownerKey, ownerInstanceId).history,
        rowId
      )
    );
  }
  remove(ownerKey: string, ownerInstanceId?: string): Promise<boolean> {
    return this.queue.enqueue(() => {
      if (this.states.get(ownerKey)?.sync.promotionExport) throw new BaseConflictError("BASE_PROMOTION_IN_PROGRESS");
      return this.removeLocked(ownerKey, ownerInstanceId);
    });
  }
  preparePromotion(chatId: string, projectId: string, intentId: string, cloud?: ConfirmedBasePromotion) {
    return this.promotion.preparePromotion(chatId, projectId, intentId, cloud);
  }
  prepareRemotePromotion(chatId: string, projectId: string, intentId: string, input?: RemoteBasePromotion) {
    return this.promotion.prepareRemotePromotion(chatId, projectId, intentId, input);
  }
  finalizePromotion(chatId: string, projectId: string, intentId: string) { return this.promotion.finalizePromotion(chatId, projectId, intentId); }
  rollbackPromotion(projectId: string, intentId: string) { return this.promotion.rollbackPromotion(projectId, intentId); }
  promotedSnapshot(projectId: string, intentId: string) { return this.promotion.promotedSnapshot(projectId, intentId); }

  closeAndFlush() {
    this.queue.close();
    return this.queue.flush();
  }

  reopen() {
    this.queue.reopen();
  }

  private lookup(ownerKey: string, ownerInstanceId?: string) {
    this.assertOwnerKey(ownerKey);
    if (this.blockedOwners.has(ownerKey)) throw new Error("Base save outcome is unknown; reopen storage before editing");
    const state = this.states.get(ownerKey);
    if (!state) return null;
    if (ownerInstanceId) this.assertInstance(state.meta, ownerInstanceId);
    return state;
  }

  /**
   * 快照不再复制：存量对象自提交起即冻结，读者与 kernel 拿到的是同一份真相。
   * IPC 出境本来就要再序列化一次，进程内再深拷一次纯属白工；而「meta-only
   * 提交不得改 rows」也因此退化成一次引用比较——最贵的守卫变成最便宜的那个。
   */
  private snapshot(state: StoredBase): BaseSnapshot {
    return { meta: state.meta, rows: state.rows };
  }

  private requireState(ownerKey: string, ownerInstanceId: string) {
    this.assertOwnerKey(ownerKey);
    if (this.blockedOwners.has(ownerKey)) throw new Error("Base save outcome is unknown; reopen storage before editing");
    const state = this.states.get(ownerKey);
    if (!state) throw new BaseNotFoundError("Base 不存在");
    this.assertInstance(state.meta, ownerInstanceId);
    return state;
  }

  private assertInstance(meta: BaseMeta, ownerInstanceId: string) {
    if (meta.ownerInstanceId !== ownerInstanceId) {
      throw new BaseIncarnationError("Base owner 生命周期已变化");
    }
  }

  private assertOwnerKey(ownerKey: string) {
    if (!BASE_OWNER_KEY_PATTERN.test(ownerKey)) {
      throw new Error("Base ownerKey 格式无效");
    }
  }

  private async ensureLocked(identity: BaseOwnerIdentity, seed?: { columns: BaseMeta["columns"]; rows: BaseRow[] }) {
    const ownerKey = ownerKeyOf(identity.owner);
    this.assertOwnerKey(ownerKey);
    if (this.blockedOwners.has(ownerKey)) throw new Error("Base recovery is required");
    const existing = this.states.get(ownerKey);
    if (existing) {
      this.assertInstance(existing.meta, identity.ownerInstanceId);
      const snapshot = this.snapshot(existing);
      const mutation = identity.navigation
        ? navigationMutation(snapshot, identity.navigation)
        : null;
      return mutation
        ? this.commitLocked(ownerKey, identity.ownerInstanceId, mutation)
        : snapshot;
    }
    if ([...this.states.values()].some(state => state.meta.ownerInstanceId === identity.ownerInstanceId)) throw new BaseConflictError("BASE_OWNER_TRANSFERRED");
    if (await this.files.readMetaIfPresent(ownerKey)) throw new Error("Base exists on disk and must be recovered before use");
    const sync = emptyBaseSync(identity.ownerInstanceId);
    const syncFile = serializeSync(sync);
    const meta = baseMetaSchema.parse({
      syncGeneration: 0, syncHash: syncFile.hash,
      owner: identity.owner,
      ownerInstanceId: identity.ownerInstanceId,
      name: identity.title?.trim() || "Untitled Base",
      navigation: identity.navigation ?? (
        identity.owner.kind === "project"
          ? { kind: "project-contained", projectId: identity.owner.projectId }
          : { kind: "conversation-contained", chatId: identity.owner.chatId }
      ),
      columns: seed?.columns ?? [],
      views: [
        {
          id: "table",
          name: "Table",
          order: 0,
          config: { type: "table" },
        },
      ],
      activeViewId: "table",
      revision: 0,
      rowsGeneration: 0,
      galleryGeneration: 0,
      historyGeneration: 0,
    });
    const rows: BaseRow[] = seed?.rows ?? [];
    validateBaseShape(meta, rows.length);
    validateStoredRows(rows, new Set(meta.columns.map(column => column.id)));
    const gallery = emptyGalleryLedger(
      galleryOwnerId(meta),
      meta.ownerInstanceId
    );
    const history = emptyHistoryLedger();
    await this.files.atomicWrite(
      this.files.rowsPath(ownerKey, 0),
      this.files.serializeRows(rows)
    );
    await this.files.atomicWrite(
      this.files.galleryPath(ownerKey, 0),
      this.files.serializeGallery(gallery)
    );
    await this.files.atomicWrite(
      this.files.historyPath(ownerKey, 0),
      this.files.serializeHistory(history)
    );
    await this.files.atomicWrite(syncPath(this.files.syncRoot, ownerKey, 0), syncFile.content);
    await this.files.atomicWrite(
      this.files.metaPath(ownerKey),
      this.files.serializeMeta(meta)
    );
    const state = storedBase({ meta, rows, gallery, history, sync });
    this.states.set(ownerKey, state);
    return this.snapshot(state);
  }

  /**
   * 一次提交的代价必须与「改了多少」成正比，不与「表有多长」成正比。
   * kernel 交上来的 changedRowIds/removedRowIds 就是这份正比关系的凭据：
   * 校验、历史差分、Gallery 派生、附件 GC 全部只认它。整表改写照旧全量体检，
   * 但那时候本来就该付全量的钱。
   */
  private async commitLocked(
    ownerKey: string,
    ownerInstanceId: string,
    input: BaseStoreMutation,
    syncOverride?: BaseSyncEnvelope
  ) {
    const current = this.requireState(ownerKey, ownerInstanceId);
    if (current.sync.promotionExport && !syncOverride) throw new BaseConflictError("BASE_PROMOTION_IN_PROGRESS");
    if (input.meta.revision !== current.meta.revision + 1) {
      throw new Error("Base commit revision 必须恰好递增 1");
    }
    const sync = syncOverride ?? enqueueBaseMutation(current, input);
    const syncChanged = sync !== current.sync;
    const syncGeneration = (current.meta.syncGeneration ?? 0) + Number(syncChanged);
    const syncFile = syncChanged ? serializeSync(sync) : null;
    const rowsChanged = mutationTouchesRows(input);
    if (!rowsChanged && input.rows !== current.rows) {
      throw new Error("meta-only commit 不允许修改 rows");
    }
    const generation = rowsChanged
      ? current.meta.rowsGeneration + 1
      : current.meta.rowsGeneration;
    const next = rowsChanged
      ? parseCommittedRows(input)
      : { rows: current.rows, rowsById: current.rowsById, changed: [] };

    let galleryChanged = Boolean(input.galleryChanged);
    let galleryInput = input.gallery;
    if (!galleryChanged && galleryCanLoseEntries(current.gallery)) {
      const derived = deriveGalleryRemovals(
        current,
        { rowsById: next.rowsById, meta: input.meta },
        this.now()
      );
      if (derived) {
        galleryInput = derived;
        galleryChanged = !sameJson(derived, current.gallery);
      }
    }
    const galleryGeneration = current.meta.galleryGeneration +
      Number(galleryChanged);
    let history: BaseHistoryLedger = current.history;
    try {
      history = appendHistoryEntry(
        current.history,
        createHistoryEntry({
          before: current.rowsById,
          after: next.rowsById,
          candidateRowIds: historyCandidates(input, current, next.rowsById),
          at: this.now(),
          actor: input.actor ?? "system",
          operation: input.operation ?? "mutation",
        })
      );
    } catch (cause) {
      // 条目「生成」失败是有损审计的可接受降级：丢条目、业务照常。
      console.warn(
        `Base ${ownerKey} history 条目生成失败，业务提交继续：${errorMessage(cause)}`
      );
    }
    const historyChanged = history !== current.history;
    const historyGeneration = current.meta.historyGeneration +
      Number(historyChanged);
    const meta = baseMetaSchema.parse({
      ...input.meta,
      owner: current.meta.owner,
      ownerInstanceId,
      syncGeneration, syncHash: syncFile?.hash ?? current.meta.syncHash,
      rowsGeneration: generation,
      galleryGeneration,
      historyGeneration,
    });
    const gallery = galleryChanged
      ? parseGalleryLedger(
          galleryInput,
          galleryOwnerId(meta),
          ownerInstanceId
        )
      : current.gallery;
    if (!galleryChanged && galleryInput && !sameJson(galleryInput, current.gallery)) {
      throw new Error("galleryChanged=false 不允许修改 Gallery ledger");
    }
    validateBaseShape(meta, next.rows.length);
    validateStoredRows(
      next.changed,
      new Set(meta.columns.map((column) => column.id))
    );
    const metaContent = this.files.serializeMeta(meta);
    // rows 只序列化一次：预算判定与落盘字节是同一串。
    const rowsContent = rowsChanged
      ? this.files.serializeRows(next.rows)
      : null;
    validateGalleryLedger(meta, next.rowsById, gallery, galleryOwnerId(meta));

    if (rowsContent !== null) {
      await this.files.atomicWrite(
        this.files.rowsPath(ownerKey, generation),
        rowsContent
      );
    }
    if (galleryChanged) {
      await this.files.atomicWrite(
        this.files.galleryPath(ownerKey, galleryGeneration),
        this.files.serializeGallery(gallery)
      );
    }
    // history 文件与 rows/gallery 同次原子发布同命运：写不下去就整单不提交，
    // 绝不留下「meta 说有第 N 代、磁盘上没有」的半提交态。
    if (historyChanged) {
      await this.files.atomicWrite(
        this.files.historyPath(ownerKey, historyGeneration),
        this.files.serializeHistory(history)
      );
    }
    if (syncFile) await this.files.atomicWrite(syncPath(this.files.syncRoot, ownerKey, syncGeneration), syncFile.content);
    // A post-rename error is unknown, so freeze this owner until a validated reopen.
    try {
      await this.files.atomicWrite(this.files.metaPath(ownerKey), metaContent);
    } catch (cause) {
      const durable = await this.files.readMetaIfPresent(ownerKey).catch(() => null);
      if (!durable || durable.revision !== current.meta.revision) this.blockedOwners.add(ownerKey);
      throw cause;
    }
    const attachmentBlobIds = new Set([...(syncChanged ? collectRowAttachmentBlobIds(next.rows) : this.trackAttachments(current, meta, next.rows)), ...syncAttachmentRoots(sync)]);
    const committed = storedBase({
      meta,
      rows: next.rows,
      rowsById: next.rowsById,
      attachmentBlobIds,
      sync,
      gallery,
      history,
    });
    this.states.set(ownerKey, committed);
    // 引用集没有收缩就没有孤儿：readdir + rm + stat 一趟全家族不该白跑。
    if ([...current.attachmentBlobIds].some((id) => !attachmentBlobIds.has(id))) {
      await this.gcAttachments(ownerKey, ownerInstanceId, attachmentBlobIds);
    }
    if (
      generation !== current.meta.rowsGeneration ||
      galleryGeneration !== current.meta.galleryGeneration ||
      historyGeneration !== current.meta.historyGeneration
    ) {
      await this.files
        .gcGenerations(
          ownerKey,
          generation,
          galleryGeneration,
          historyGeneration,
          syncGeneration
        )
        .catch((cause) =>
          console.warn(`Base ${ownerKey} 旧世代清理失败：${errorMessage(cause)}`)
        );
    }
    return this.snapshot(committed);
  }

  /**
   * 附件引用集只在「这张表可能有附件」时重算：没有 attachment 列、
   * 历史上也没引用过任何 blob 的 Base，永远不必为附件走一趟全表。
   */
  private trackAttachments(
    current: StoredBase,
    meta: BaseMeta,
    rows: readonly BaseRow[]
  ): ReadonlySet<string> {
    if (rows === current.rows) return current.attachmentBlobIds;
    const possible =
      current.attachmentBlobIds.size > 0 ||
      meta.columns.some((column) => column.type === "attachment");
    return possible ? collectRowAttachmentBlobIds(rows) : NO_BLOBS;
  }

  private async gcAttachments(
    ownerKey: string,
    ownerInstanceId: string,
    referenced: ReadonlySet<string>
  ) {
    await this.attachments
      .gcFamily(ownerFileStem(ownerKey), ownerInstanceId, referenced)
      .catch((cause) =>
        console.warn(`Base ${ownerKey} attachment GC 失败：${errorMessage(cause)}`)
      );
  }

  private async removeLocked(ownerKey: string, ownerInstanceId?: string) {
    this.assertOwnerKey(ownerKey);
    if (this.blockedOwners.has(ownerKey)) throw new Error("Base save outcome is unknown; reopen storage before editing");
    const state = this.states.get(ownerKey);
    if (
      state &&
      ownerInstanceId &&
      state.meta.ownerInstanceId !== ownerInstanceId
    ) {
      return false;
    }
    if (!state) {
      const diskMeta = await this.files.readMetaIfPresent(ownerKey);
      if (
        diskMeta &&
        ownerInstanceId &&
        diskMeta.ownerInstanceId !== ownerInstanceId
      ) {
        return false;
      }
    }
    await this.files.removeFamilyFiles(ownerKey);
    const instance = state?.meta.ownerInstanceId ?? ownerInstanceId;
    if (instance) {
      await this.attachments.releaseFamily(
        ownerFileStem(ownerKey),
        instance,
        "deleted-proven"
      );
    }
    this.states.delete(ownerKey);
    return Boolean(state);
  }
}

/**
 * 只把被声明动过的行送进 schema 归一：其余行仍是上一版那批冻结对象，
 * 它们在写入自己那一代时已经体检过，再 parse 一次只是重复付钱。
 * 顺手产出 id 索引——唯一性检查与索引本就是同一趟循环的两个副产品。
 */
function parseCommittedRows(input: BaseStoreMutation) {
  const rows = input.rows.slice();
  const rowsById = new Map<string, BaseRow>();
  const positions = new Map<string, number>();
  for (const [index, row] of rows.entries()) {
    if (rowsById.has(row.id)) throw new Error(`Base row id 重复：${row.id}`);
    rowsById.set(row.id, row);
    positions.set(row.id, index);
  }
  const changed: BaseRow[] = [];
  const normalize = (index: number) => {
    const parsed = baseRowSchema.parse(rows[index]!);
    rows[index] = parsed;
    rowsById.set(parsed.id, parsed);
    changed.push(parsed);
  };
  if (input.changedRowIds === ALL_ROWS_CHANGED) {
    for (let index = 0; index < rows.length; index += 1) normalize(index);
  } else {
    for (const rowId of input.changedRowIds) {
      const index = positions.get(rowId);
      if (index !== undefined) normalize(index);
    }
  }
  return { rows, rowsById, changed };
}

/** 历史差分的候选集：声明变更 + 声明删除；整表改写才回到前后并集。 */
function historyCandidates(
  input: BaseStoreMutation,
  current: StoredBase,
  nextById: ReadonlyMap<string, BaseRow>
): Iterable<string> {
  if (input.changedRowIds === ALL_ROWS_CHANGED) {
    return new Set([...current.rowsById.keys(), ...nextById.keys()]);
  }
  if (!input.removedRowIds?.size) return input.changedRowIds;
  return [...input.changedRowIds, ...input.removedRowIds];
}
