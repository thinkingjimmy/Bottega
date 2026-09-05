/**
 * [INPUT]: Depends on shared owner-aware Base/Gallery/navigation schemas, durable file IO, attachments, startup loading, and SerialQueue
 * [OUTPUT]: Provides owner-key indexed frozen Base storage with an id index, rows/gallery/history, canonical navigation mutation, pre-copy query snapshot byte identity, declaration-scoped generation commits, and promotion primitives
 * [POS]: Durable Base authority; lifecycle services classify visibility here while renderer projections only consume summaries
 */
import { join } from "node:path";
import {
  BASE_OWNER_KEY_PATTERN,
  ownerKeyOf,
  type BaseMeta,
  type BaseRow,
  type BaseSnapshot,
} from "../../../shared/bases-ipc";
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
import { BaseStoreFiles, ownerFileStem } from "./store/base-files";
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
import { prepareProjectBase } from "./store/base-promotion";
import { initializeBaseStoreStartup } from "./store/startup";
import {
  ALL_ROWS_CHANGED,
  NO_ROWS_CHANGED,
  BaseConflictError,
  BaseIncarnationError,
  BaseNotFoundError,
  chatOwnerIdentity,
  galleryOwnerId,
  mutationTouchesRows,
  projectOwnerIdentity,
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
  baseOwnerSummaries,
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
const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);
const NO_BLOBS: ReadonlySet<string> = new Set<string>();
export class BaseStore {
  readonly basesRoot: string;
  readonly root: string;
  readonly exportsRoot: string;
  readonly attachments: BaseAttachmentStore;
  private readonly queue = new SerialQueue();
  private readonly states = new Map<string, StoredBase>();
  private readonly files: BaseStoreFiles;
  private readonly now: () => number;
  constructor(
    userData: string,
    private readonly dependencies: BaseStoreDependencies = {}
  ) {
    /* 目录布局是既有数据的既成事实：bases/ 下 v2 与 exports 的路径字节不可动。 */
    this.basesRoot = join(userData, "bases");
    this.root = join(this.basesRoot, "v2");
    this.exportsRoot = join(this.basesRoot, "exports");
    this.attachments = new BaseAttachmentStore(this.root);
    this.now = dependencies.now ?? Date.now;
    this.files = new BaseStoreFiles(this.root, {
      readText: dependencies.readText,
      atomicWrite: dependencies.atomicWrite,
    });
  }
  async initialize(
    chats: ReadonlyMap<string, BaseIdentity>,
    projectIds: ReadonlySet<string> = new Set()
  ) {
    await this.queue.enqueue(() =>
      initializeBaseStoreStartup({
        root: this.root,
        exportsRoot: this.exportsRoot,
        files: this.files,
        attachments: this.attachments,
        states: this.states,
        chats,
        projectIds,
        now: this.now,
      })
    );
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
  baseSummaries() {
    return baseOwnerSummaries(this.states);
  }
  listRootBases() {
    return rootBaseSummaries(this.states.values());
  }
  listProjectBases() {
    return projectBaseSummaries(this.states.values());
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
    return this.queue.enqueue(() =>
      this.removeLocked(ownerKey, ownerInstanceId)
    );
  }
  /**
   * Promotion 的本地提交点：先完整复制 attachment/rows/gallery，再发布 project meta。
   * lifecycle intent 的 phase 推进与终态不在叶子 queue 内执行。
   */
  preparePromotion(
    chatId: string,
    projectId: string,
    intentId: string
  ): Promise<BaseSnapshot> {
    return this.queue.enqueue(async () => {
      const fromKey = `chat:${chatId}`;
      const toKey = `project:${projectId}`;
      const existing = this.states.get(toKey);
      if (existing) {
        if (existing.meta.ownerInstanceId !== intentId) {
          throw new BaseConflictError("Project 已有 Base");
        }
        return this.snapshot(existing);
      }
      const source = this.requireState(
        fromKey,
        this.states.get(fromKey)?.meta.ownerInstanceId ?? ""
      );
      const state = await prepareProjectBase({
        source,
        fromKey,
        toKey,
        projectId,
        intentId,
        files: this.files,
        attachments: this.attachments,
        writeMeta: (ownerKey, content) =>
          this.files.atomicWrite(this.files.metaPath(ownerKey), content),
      });
      this.states.set(toKey, state);
      return this.snapshot(state);
    });
  }
  finalizePromotion(
    chatId: string,
    projectId: string,
    intentId: string
  ): Promise<BaseSnapshot> {
    return this.queue.enqueue(async () => {
      const fromKey = `chat:${chatId}`;
      const toKey = `project:${projectId}`;
      const target = this.requireState(toKey, intentId);
      const source = this.states.get(fromKey);
      await this.removeLocked(fromKey, source?.meta.ownerInstanceId);
      return this.snapshot(target);
    });
  }

  rollbackPromotion(projectId: string, intentId: string) {
    return this.queue.enqueue(async () => {
      const ownerKey = `project:${projectId}`;
      const state = this.states.get(ownerKey);
      if (state && state.meta.ownerInstanceId !== intentId) {
        throw new BaseIncarnationError("待回滚 Project Base 生命周期已变化");
      }
      await this.files.removeFamilyFiles(ownerKey);
      await this.attachments.releaseFamily(
        ownerFileStem(ownerKey),
        intentId,
        "deleted-proven"
      );
      this.states.delete(ownerKey);
      return Boolean(state);
    });
  }

  closeAndFlush() {
    this.queue.close();
    return this.queue.flush();
  }

  reopen() {
    this.queue.reopen();
  }

  private lookup(ownerKey: string, ownerInstanceId?: string) {
    this.assertOwnerKey(ownerKey);
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

  private async ensureLocked(identity: BaseOwnerIdentity) {
    const ownerKey = ownerKeyOf(identity.owner);
    this.assertOwnerKey(ownerKey);
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
    const meta = baseMetaSchema.parse({
      owner: identity.owner,
      ownerInstanceId: identity.ownerInstanceId,
      name: identity.title?.trim() || "Untitled Base",
      navigation: identity.navigation ?? (
        identity.owner.kind === "project"
          ? { kind: "project-contained", projectId: identity.owner.projectId }
          : { kind: "conversation-contained", chatId: identity.owner.chatId }
      ),
      columns: [],
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
    const rows: BaseRow[] = [];
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
    await this.files.atomicWrite(
      this.files.metaPath(ownerKey),
      this.files.serializeMeta(meta)
    );
    const state = storedBase({ meta, rows, gallery, history });
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
    input: BaseStoreMutation
  ) {
    const current = this.requireState(ownerKey, ownerInstanceId);
    if (input.meta.revision !== current.meta.revision + 1) {
      throw new Error("Base commit revision 必须恰好递增 1");
    }
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
        galleryChanged = !same(derived, current.gallery);
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
    if (!galleryChanged && galleryInput && !same(galleryInput, current.gallery)) {
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
    // meta 是发布点：写不下去就整单不提交，内存状态原样保留。
    await this.files.atomicWrite(this.files.metaPath(ownerKey), metaContent);
    const attachmentBlobIds = this.trackAttachments(current, meta, next.rows);
    const committed = storedBase({
      meta,
      rows: next.rows,
      rowsById: next.rowsById,
      attachmentBlobIds,
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
          historyGeneration
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
