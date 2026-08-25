/**
 * [INPUT]: Depends on Electron IPC ChatStore/BaseStore Product snapshot Project archiving narrow queries HistoryImport Search narrow gateway search/query with shared SearchJob contract
 * [OUTPUT]: Provides GlobalSearchService: snapshot-fenced start, Chat/Base Priority with History, async lane, message locator, credit/byte backpressure, 250ms page budget, only cut the session boundary, only recognize job signal in flight parse, shut down - re-lock, skip disclosure, single-mode delivery epoch cursor, single pull threshold, cancel/TTL/capacity unified dispose
 * [POS]: search for the renderer job owner; Start freezing only product snapshots and external metadata, external source is valid for session-by-session analysis and fail-soft during pull period
 */

import { createHash, randomUUID } from "node:crypto";
import type { BrowserWindow } from "electron";
import { z } from "zod";
import { ownerFromKey } from "../../../shared/bases-ipc";
import {
  SEARCH_JOB_CHANNEL,
  type GlobalSearchHit,
  type PullSearchInput,
  type SearchJobPage,
} from "../../../shared/search-ipc";
import type { ChatStore } from "../chats/chat-store";
import type { BaseStore, ReadonlyBaseSnapshot } from "../bases/base-store";
import type {
  HistoryImportService,
  SearchableHistoryEntry,
} from "../history-import/service";
import { rendererIpc } from "../ipc-registrar";
import {
  makeSnippet,
  scanBase,
  scanChat,
  scanHistoryBlocks,
  tokenize,
  type Checkpoint,
  type ScanCounter,
  type JobSearchLocator,
} from "./query";

const JOB_TTL = 5 * 60_000;
const MAX_JOBS = 8;
const HISTORY_PAGE_MS = 250;
const inputSchema = z.object({ query: z.string().trim().min(1).max(512) }).strict();
const pullSchema = z.object({
  jobId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  cursor: z.string().min(1).max(1024),
  credit: z.number().int().min(1).max(50),
  byteBudget: z.number().int().min(1024).max(512 * 1024),
}).strict();

type FrozenSource = {
  chats: NonNullable<Awaited<ReturnType<ChatStore["get"]>>>[];
  bases: Array<{
    ownerKey: string;
    snapshot: ReadonlyBaseSnapshot;
    title: string | null;
    sectionId: string | null;
  }>;
  history: SearchableHistoryEntry[];
  archivedChatRoutes: Record<string, string>;
  archivedBaseRoutes: Record<string, string>;
};

type Boundary = { kind: "history-boundary" };
type PageBoundary = { kind: "history-page-boundary" };
type StreamEvent = GlobalSearchHit | Checkpoint | Boundary | PageBoundary;
type Progress = { skippedSessions: number };
type PageSignal = { signal: AbortSignal };
type Job = {
  id: string;
  revision: string;
  deliveryEpoch: number;
  scanned: number;
  skipped: number;
  expiresAt: number;
  counter: ScanCounter;
  progress: Progress;
  controller: AbortController;
  iterator: AsyncGenerator<StreamEvent>;
  inFlight: boolean;
  inHistory: boolean;
  page: PageSignal;
  pendingHit?: GlobalSearchHit;
};

type HistorySearchPort = Pick<
  HistoryImportService,
  | "listSearchableEntries"
  | "parseTranscriptForSearch"
  | "readAdoptionSnapshotForSearch"
>;

export class GlobalSearchService {
  private readonly jobs = new Map<string, Job>();

  constructor(
    private readonly chats: ChatStore,
    private readonly bases: BaseStore,
    private readonly projectArchivedAt: (
      projectId: string
    ) => number | null | undefined = () => null,
    private readonly history?: HistorySearchPort
  ) {}

  register(window: BrowserWindow, rendererUrl: string) {
    rendererIpc(window, rendererUrl, "拒绝非主窗口的全局搜索请求")
      .handle(SEARCH_JOB_CHANNEL.start, (raw) =>
        this.start(inputSchema.parse(raw).query)
      )
      .handle(SEARCH_JOB_CHANNEL.pull, (raw) =>
        this.pull(pullSchema.parse(raw))
      )
      .handle(SEARCH_JOB_CHANNEL.cancel, (raw) =>
        this.cancel(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).parse(raw))
      );
  }

  async start(query: string) {
    this.sweep();
    if (this.jobs.size >= MAX_JOBS) {
      const oldest = this.jobs.keys().next().value;
      if (oldest) await this.disposeJob(oldest);
    }
    const tokens = tokenize(query);
    const source = await this.freeze();
    const revision = sourceRevision(source, this.chats.getStoreRevision());
    const id = `search_${randomUUID().replaceAll("-", "")}`;
    const counter = { scanned: 0 };
    const progress = { skippedSessions: 0 };
    const controller = new AbortController();
    const page = { signal: controller.signal };
    const job: Job = {
      id,
      revision,
      deliveryEpoch: 0,
      scanned: 0,
      skipped: 0,
      counter,
      progress,
      controller,
      expiresAt: Date.now() + JOB_TTL,
      inFlight: false,
      inHistory: false,
      page,
      iterator: scanFrozen(
        source,
        tokens,
        counter,
        progress,
        controller.signal,
        page,
        this.history
      ),
    };
    this.jobs.set(id, job);
    return {
      jobId: id,
      snapshotRevision: revision,
      cursor: cursorOf(job),
    };
  }

  async pull(input: PullSearchInput): Promise<SearchJobPage> {
    this.sweep();
    const job = this.jobs.get(input.jobId);
    if (!job || cursorOf(job) !== input.cursor) {
      throw new Error("搜索 cursor 已失效");
    }
    if (job.inFlight) throw new Error("同一搜索任务已有 pull 正在执行");
    const pageLease = createHistoryPageLease(job.controller.signal);
    job.page.signal = pageLease.signal;
    job.inFlight = true;
    try {
      return await this.pullSerial(job, input);
    } catch (cause) {
      await this.disposeJob(job.id);
      throw cause;
    } finally {
      pageLease.dispose();
      job.inFlight = false;
    }
  }

  async cancel(jobId: string) {
    await this.disposeJob(jobId);
  }

  private async pullSerial(job: Job, input: PullSearchInput): Promise<SearchJobPage> {
    const hits: GlobalSearchHit[] = [];
    let bytes = 2;
    let done = false;
    let steps = 0;
    const startedAt = Date.now();
    const stepBudget = input.credit * 10 + 1;
    while (hits.length < input.credit && steps < stepBudget) {
      if (job.inHistory && Date.now() - startedAt >= HISTORY_PAGE_MS) break;
      let value: StreamEvent;
      if (job.pendingHit) {
        value = job.pendingHit;
        job.pendingHit = undefined;
      } else {
        const next = await job.iterator.next();
        steps += 1;
        job.scanned = job.counter.scanned;
        if (next.done) {
          done = true;
          break;
        }
        value = next.value;
      }
      if (isHistoryBoundary(value)) {
        job.inHistory = true;
        if (hits.length) break;
        continue;
      }
      if (isHistoryPageBoundary(value)) break;
      if (isCheckpoint(value)) continue;
      const size = Buffer.byteLength(JSON.stringify(value), "utf8") + 1;
      if (bytes + size > input.byteBudget) {
        if (!hits.length) job.skipped += 1;
        else {
          job.pendingHit = value;
          break;
        }
      } else {
        hits.push(value);
        bytes += size;
      }
    }
    job.deliveryEpoch += 1;
    job.expiresAt = Date.now() + JOB_TTL;
    if (done) await this.disposeJob(job.id);
    return {
      hits,
      nextCursor: done ? null : cursorOf(job),
      done,
      scanned: job.scanned,
      skipped: job.skipped,
      skippedSessions: job.progress.skippedSessions,
      snapshotRevision: job.revision,
    };
  }

  private async freeze(): Promise<FrozenSource> {
    const chats = (
      await Promise.all(
        this.chats.list().map((summary) => this.chats.get(summary.id))
      )
    )
      .filter((record): record is NonNullable<typeof record> => Boolean(record))
      .map((record) => structuredClone(record));
    const summaries = new Map(chats.map((record) => [record.id, record]));
    const archivedChatRoutes = Object.fromEntries(
      chats.flatMap((record) => {
        if (record.archivedAt) return [[record.id, archiveRoute("chat", record.id)]];
        if (record.projectId && this.projectArchivedAt(record.projectId)) {
          return [[record.id, archiveRoute("project", record.projectId)]];
        }
        return [];
      })
    );
    const archivedBaseRoutes: Record<string, string> = {};
    const bases = this.bases.listAll().map(({ ownerKey, snapshot }) => {
      const owner = ownerFromKey(ownerKey);
      const chat = owner.kind === "chat" ? summaries.get(owner.chatId) : undefined;
      const archivedRoute = owner.kind === "chat"
        ? archivedChatRoutes[owner.chatId]
        : this.projectArchivedAt(owner.projectId)
          ? archiveRoute("project", owner.projectId)
          : undefined;
      if (archivedRoute) archivedBaseRoutes[ownerKey] = archivedRoute;
      return {
        ownerKey,
        snapshot: structuredClone(snapshot),
        title: chat?.title ?? null,
        sectionId: chat?.id ?? null,
      };
    });
    const history = (this.history?.listSearchableEntries() ?? [])
      .map((entry) => structuredClone(entry))
      .sort((left, right) =>
        right.updatedAt - left.updatedAt || left.opaqueId.localeCompare(right.opaqueId)
      );
    return { chats, bases, history, archivedChatRoutes, archivedBaseRoutes };
  }

  private sweep() {
    const now = Date.now();
    for (const [id, job] of this.jobs) {
      if (job.expiresAt <= now) void this.disposeJob(id);
    }
  }

  private async disposeJob(id: string) {
    const job = this.jobs.get(id);
    if (!job) return;
    this.jobs.delete(id);
    job.controller.abort();
    await job.iterator.return(undefined).catch(() => undefined);
  }
}

async function* scanFrozen(
  source: FrozenSource,
  tokens: string[],
  counter: ScanCounter,
  progress: Progress,
  signal: AbortSignal,
  page: PageSignal,
  history: HistorySearchPort | undefined
): AsyncGenerator<StreamEvent> {
  for (const chat of source.chats) {
    for (const event of scanChat(counter, chat, tokens)) {
      if (event.kind !== "locator") {
        yield event;
        continue;
      }
      const messageId = event.matched === "message"
        ? chat.messages.find((message) => message.seq === event.messageSeq)?.id
        : undefined;
      yield locatorHit(event, source.archivedChatRoutes[chat.id], messageId);
    }
  }
  for (const base of source.bases) {
    for (const event of scanBase(
      counter,
      { id: base.sectionId, title: base.title },
      base.ownerKey,
      base.snapshot,
      tokens
    )) {
      yield event.kind === "locator"
        ? locatorHit(event, source.archivedBaseRoutes[base.ownerKey])
        : event;
    }
  }
  if (!history || !source.history.length) return;
  yield { kind: "history-boundary" };
  for (const entry of source.history) {
    signal.throwIfAborted();
    /* claimed 非 adopted 的正文即产品 messages，Chat lane 已覆盖——
       跳过但不计入披露：它不是「搜不到的会话」。 */
    if (entry.claimed && !entry.claimed.adopted) continue;
    if (!entry.policySearchable || entry.archived) {
      progress.skippedSessions += 1;
      continue;
    }
    /* 页预算只裁「会话边界」：预算耗尽就挂起等下一页，绝不中止在飞的
       parse——单会话 parse 超过 250ms 时，中止-重来会退化成永不收敛的
       活锁（每页从零重跑同一个文件）。在飞 parse 只认 job signal
       （cancel/TTL/容量淘汰仍即时生效），跑完的成果永远交付。 */
    while (page.signal.aborted) {
      yield { kind: "history-page-boundary" };
    }
    let blocks: Awaited<ReturnType<HistorySearchPort["parseTranscriptForSearch"]>>;
    try {
      blocks = entry.claimed?.adopted
        ? await history.readAdoptionSnapshotForSearch(
            entry.claimed.adoptionSnapshotId!,
            entry.claimed.snapshotDigest!,
            signal
          )
        : await history.parseTranscriptForSearch(
            entry.opaqueId,
            { fingerprint: entry.fingerprint, historyRevision: entry.historyRevision },
            signal
          );
    } catch (cause) {
      if (signal.aborted) throw cause;
      progress.skippedSessions += 1;
      continue;
    }
    {
      const routeBase = entry.claimed?.adopted
        ? `/chat/${entry.claimed.chatId}`
        : `/history/${entry.opaqueId}`;
      for (const event of scanHistoryBlocks(counter, entry, blocks, tokens)) {
        yield event.kind === "locator"
          ? locatorHit(event, undefined, undefined, routeBase)
          : event;
      }
    }
    yield { kind: "checkpoint", scanned: counter.scanned };
  }
}

function locatorHit(
  locator: JobSearchLocator,
  archivedRoute?: string,
  messageId?: string,
  historyRoute?: string
): GlobalSearchHit {
  if (locator.source === "chat") {
    return {
      key: `chat:${locator.sectionId}:${locator.matched}:${
        "messageSeq" in locator ? locator.messageSeq : 0
      }`,
      source: "chat",
      title: locator.title ?? "Untitled chat",
      subtitle: locator.agent,
      snippet: makeSnippet(locator.normalizedText, locator.offset),
      route: archivedRoute ?? `/chat/${locator.sectionId}`,
      updatedAt: locator.updatedAt,
      matched: locator.matched,
      ...(messageId && !archivedRoute
        ? { target: { kind: "chat-message" as const, messageId } }
        : {}),
    };
  }
  if (locator.source === "history") {
    const offset = `${locator.historyRevision}:${locator.renderedRowKey}`;
    return {
      key: `history:${locator.opaqueId}:${locator.matched}:${locator.renderedRowKey}`,
      source: "history",
      sourceKind: locator.sourceKind,
      title: locator.title,
      subtitle: locator.projectId,
      snippet: makeSnippet(locator.normalizedText, locator.offset),
      route: historyRoute ?? `/history/${locator.opaqueId}`,
      updatedAt: locator.updatedAt,
      matched: locator.matched,
      ...(locator.matched === "message"
        ? { target: { kind: "history-block" as const, offset } }
        : {}),
    };
  }
  const owner = ownerFromKey(locator.ownerKey);
  return {
    key: `base:${locator.ownerKey}:${locator.matched}:${
      "rowId" in locator ? locator.rowId : "meta"
    }:${"columnId" in locator ? locator.columnId : ""}`,
    source: "base",
    title: locator.baseName,
    subtitle: locator.chatTitle ?? owner.kind,
    snippet: makeSnippet(locator.normalizedText, locator.offset),
    route: archivedRoute ?? (owner.kind === "chat"
      ? `/bases/chat/${owner.chatId}`
      : `/bases/project/${owner.projectId}`),
    updatedAt: 0,
    matched: locator.matched,
  };
}

function cursorOf(job: Pick<Job, "id" | "revision" | "deliveryEpoch">) {
  return Buffer.from(
    JSON.stringify({ id: job.id, revision: job.revision, epoch: job.deliveryEpoch })
  ).toString("base64url");
}

function sourceRevision(source: FrozenSource, chatRevision: number) {
  return createHash("sha256")
    .update(JSON.stringify({
      chatRevision,
      bases: source.bases.map((base) => [
        base.ownerKey,
        base.snapshot.meta.revision,
        base.snapshot.meta.rowsGeneration,
      ]),
      history: source.history.map((entry) => [
        entry.opaqueId,
        entry.historyRevision,
        entry.fingerprint,
        entry.claimed,
        entry.archived,
        entry.policySearchable,
      ]),
      archivedChatRoutes: source.archivedChatRoutes,
      archivedBaseRoutes: source.archivedBaseRoutes,
    }))
    .digest("hex");
}

const archiveRoute = (kind: "chat" | "project", id: string) =>
  `/settings/archive?target=${encodeURIComponent(`${kind}:${id}`)}`;

function isCheckpoint(value: StreamEvent): value is Checkpoint {
  return "kind" in value && value.kind === "checkpoint";
}

function isHistoryBoundary(value: StreamEvent): value is Boundary {
  return "kind" in value && value.kind === "history-boundary";
}

function isHistoryPageBoundary(value: StreamEvent): value is PageBoundary {
  return "kind" in value && value.kind === "history-page-boundary";
}

function createHistoryPageLease(jobSignal: AbortSignal) {
  const controller = new AbortController();
  const abortFromJob = () => controller.abort(jobSignal.reason);
  if (jobSignal.aborted) abortFromJob();
  else jobSignal.addEventListener("abort", abortFromJob, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error("HISTORY_PAGE_BUDGET_EXHAUSTED")),
    HISTORY_PAGE_MS
  );
  timer.unref();
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      jobSignal.removeEventListener("abort", abortFromJob);
    },
  };
}
