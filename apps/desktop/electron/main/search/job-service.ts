/**
 * [INPUT]: Depends on Electron IPC, ChatStore gram-FTS candidates, BaseStore snapshots, archived Project facts, the exact query matcher, and shared SearchJob contracts
 * [OUTPUT]: Provides GlobalSearchService with per-hit-fenced lazy Agent-identified Product Chat→Base lanes that skip stale hits instead of failing the job, keyset Chat-document paging that a mid-scan write cannot shift, exact post-filtering before limits, bounded resident pages, backpressure, cancellation that always drains the iterator, and TTL
 * [POS]: Renderer search job owner; SQLite supplies Product Chat candidates while Base keeps its own bounded logical lane
 */

import { createHash, randomUUID } from "node:crypto";
import type { BrowserWindow } from "electron";
import { z } from "zod";
import { baseNavigationOf, ownerFromKey } from "../../../shared/bases-ipc";
import {
  SEARCH_JOB_CHANNEL,
  type GlobalSearchHit,
  type PullSearchInput,
  type SearchJobPage,
} from "../../../shared/search-ipc";
import type { ChatStore } from "../chats/chat-store";
import type {
  SearchDocumentCursor,
  SearchDocumentHit,
} from "../chats/sqlite/database-protocol";
import type { ChatSummary } from "../../../shared/chats-ipc";
import {
  appearsInSearchBase,
  searchDestination,
} from "../../../shared/placement/search";
import {
  productDestinationRoute,
  type ProductDestination,
} from "../../../shared/placement/facts";
import type { BaseStore, ReadonlyBaseSnapshot } from "../bases/base-store";
import { rendererIpc } from "../ipc-registrar";
import {
  makeSnippet,
  matchTokens,
  normalize,
  scanBase,
  tokenize,
  type Checkpoint,
  type ScanCounter,
  type SearchLocator,
} from "./query";

const JOB_TTL = 5 * 60_000;
const MAX_JOBS = 8;
const inputSchema = z.object({ query: z.string().trim().min(1).max(512) }).strict();
const pullSchema = z.object({
  jobId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  cursor: z.string().min(1).max(1024),
  credit: z.number().int().min(1).max(50),
  byteBudget: z.number().int().min(1024).max(512 * 1024),
}).strict();

type FrozenSource = {
  chats: ChatSummary[];
  loadChatHits: (cursor: SearchDocumentCursor | null) => Promise<{
    hits: SearchDocumentHit[];
    nextCursor: SearchDocumentCursor | null;
  }>;
  chatStoreRevision: number;
  bases: Array<{
    ownerKey: string;
    snapshot: ReadonlyBaseSnapshot;
    title: string | null;
    sectionId: string | null;
  }>;
  archivedChatDestinations: Record<string, ProductDestination>;
  archivedBaseDestinations: Record<string, ProductDestination>;
};

type Lane = "chat" | "base";
type LaneBoundary = { kind: "lane-boundary"; lane: Lane };
type StreamEvent = GlobalSearchHit | Checkpoint | LaneBoundary;
type Job = {
  id: string;
  revision: string;
  deliveryEpoch: number;
  scanned: number;
  /** 被字节预算挤掉的命中；围栏跳过的那部分由 counter.skipped 记账。 */
  byteSkipped: number;
  expiresAt: number;
  counter: ScanCounter;
  controller: AbortController;
  iterator: AsyncGenerator<StreamEvent>;
  inFlight: boolean;
  /** 在途 pull 的收尾闩：disposeJob 把 iterator.return() 挂在它后面。 */
  settled?: Promise<void>;
  closing?: Promise<void>;
  lane: Lane;
  lastIdentity: string | null;
  pendingHit?: GlobalSearchHit;
};

export class GlobalSearchService {
  private readonly jobs = new Map<string, Job>();

  constructor(
    private readonly chats: ChatStore,
    private readonly bases: BaseStore,
    private readonly projectArchivedAt: (
      projectId: string
    ) => number | null | undefined = () => null
  ) {}

  register(window: BrowserWindow, rendererUrl: string) {
    rendererIpc(window, rendererUrl, "拒绝非主窗口的全局搜索请求")
      .roles("main")
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
    const source = await this.freeze(tokens);
    const revision = sourceRevision(source, source.chatStoreRevision);
    const id = `search_${randomUUID().replaceAll("-", "")}`;
    const counter: ScanCounter = { scanned: 0, skipped: 0 };
    const controller = new AbortController();
    const job: Job = {
      id,
      revision,
      deliveryEpoch: 0,
      scanned: 0,
      byteSkipped: 0,
      counter,
      controller,
      expiresAt: Date.now() + JOB_TTL,
      inFlight: false,
      lane: "chat",
      lastIdentity: null,
      iterator: scanFrozen(source, tokens, counter, controller.signal),
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
    if (!job) throw new Error("搜索 cursor 已失效");
    if (job.inFlight) throw new Error("同一搜索任务已有 pull 正在执行");
    if (cursorOf(job) !== input.cursor) throw new Error("搜索 cursor 已失效");
    job.inFlight = true;
    let settle!: () => void;
    job.settled = new Promise<void>((resolve) => { settle = resolve; });
    try {
      return await this.pullSerial(job, input);
    } catch (cause) {
      await this.disposeJob(job.id);
      throw cause;
    } finally {
      job.inFlight = false;
      settle();
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
    const stepBudget = input.credit * 10 + 1;
    while (hits.length < input.credit && steps < stepBudget) {
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
      if (isLaneBoundary(value)) {
        job.lane = value.lane;
        continue;
      }
      if (isCheckpoint(value)) continue;
      const size = Buffer.byteLength(JSON.stringify(value), "utf8") + 1;
      if (bytes + size > input.byteBudget) {
        if (!hits.length) job.byteSkipped += 1;
        else {
          job.pendingHit = value;
          break;
        }
      } else {
        hits.push(value);
        job.lastIdentity = value.key;
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
      skipped: job.byteSkipped + job.counter.skipped,
      snapshotRevision: job.revision,
    };
  }

  private async freeze(tokens: string[]): Promise<FrozenSource> {
    const chatStoreRevision = this.chats.getStoreRevision();
    /* 全局 revision 每一次写入都会前进：拿它当扫描围栏，等于让任何一条无关
       Chat 的改名把正在读的搜索结果整个作废。围栏留在命中一侧（逐条比对
       所属 Chat 的 record/message revision），过期的那一条跳过就是了。 */
    const loadChatHits = async (cursor: SearchDocumentCursor | null) => {
      const page = await this.chats.searchTimelineDocuments(tokens, cursor, 500);
      return {
        hits: page.hits.map((hit) => structuredClone(hit)),
        nextCursor: page.nextCursor,
      };
    };
    const chats = this.chats.list().map((summary) => structuredClone(summary));
    const summaries = new Map(chats.map((record) => [record.id, record]));
    const archivedChatDestinations = Object.fromEntries(
      chats.flatMap((record) => {
        if (record.archivedAt) {
          return [[record.id, archiveDestination("chat", record.id)]];
        }
        if (record.projectId && this.projectArchivedAt(record.projectId)) {
          return [[record.id, archiveDestination("project", record.projectId)]];
        }
        return [];
      })
    );
    const archivedBaseDestinations: Record<string, ProductDestination> = {};
    const bases = this.bases.listAll().flatMap(({ ownerKey, snapshot }) => {
      const owner = ownerFromKey(ownerKey);
      const chat = owner.kind === "chat" ? summaries.get(owner.chatId) : undefined;
      if (!appearsInSearchBase(
        baseNavigationOf(snapshot.meta),
        owner.kind !== "chat" || Boolean(chat && searchDestination(chat))
      )) return [];
      const archivedRoute = owner.kind === "chat"
        ? archivedChatDestinations[owner.chatId]
        : this.projectArchivedAt(owner.projectId)
          ? archiveDestination("project", owner.projectId)
          : undefined;
      if (archivedRoute) archivedBaseDestinations[ownerKey] = archivedRoute;
      return [{
        ownerKey,
        snapshot: structuredClone(snapshot),
        title: chat?.title ?? null,
        sectionId: chat?.id ?? null,
      }];
    });
    return {
      chats,
      loadChatHits,
      chatStoreRevision,
      bases,
      archivedChatDestinations,
      archivedBaseDestinations,
    };
  }

  private sweep() {
    const now = Date.now();
    for (const [id, job] of this.jobs) {
      if (job.expiresAt <= now) void this.disposeJob(id);
    }
  }

  /* 关闭必须真的走到 iterator.return()：pull 在途时只 abort 就退出，会把
     生成器的 finally（游标、worker 句柄）永远吊在那里。改为把收尾挂到那次
     pull 的尾巴上，无论它成功还是抛出都收。 */
  private async disposeJob(id: string) {
    const job = this.jobs.get(id);
    if (!job) return;
    this.jobs.delete(id);
    job.controller.abort();
    if (job.inFlight && job.settled) {
      job.closing = job.settled.then(() => this.closeIterator(job));
      return;
    }
    await this.closeIterator(job);
  }

  private closeIterator(job: Job) {
    return job.iterator.return(undefined).then(() => undefined, () => undefined);
  }
}

async function* scanFrozen(
  source: FrozenSource,
  tokens: string[],
  counter: ScanCounter,
  signal: AbortSignal
): AsyncGenerator<StreamEvent> {
  const summaries = new Map(source.chats.map((chat) => [chat.id, chat]));
  let cursor: SearchDocumentCursor | null = null;
  while (true) {
    signal.throwIfAborted();
    const page = await source.loadChatHits(cursor);
    for (const hit of page.hits) {
      signal.throwIfAborted();
      counter.scanned += 1;
      if (counter.scanned % 500 === 0) yield { kind: "checkpoint", scanned: counter.scanned };
      if (matchTokens(hit.searchText, tokens) === null) continue;
      const chat = summaries.get(hit.chatId);
      if (!chat ||
        chat.chatRecordRevision !== hit.coreRevision ||
        chat.chatMessageRevision !== hit.nativeMessageRevision) {
        counter.skipped += 1;
        continue;
      }
      const destination = searchDestination(chat);
      if (!destination) continue;
      const normalizedText = normalize(hit.searchText);
      const offset = Math.min(...tokens.map((token) => normalizedText.indexOf(normalize(token))).filter((value) => value >= 0));
      const locator = hit.documentKind === "title"
        ? {
          kind: "locator" as const,
          source: "chat" as const,
          sectionId: hit.chatId,
          title: hit.title,
          agent: hit.agent,
          updatedAt: hit.updatedAt,
          matched: "title" as const,
          normalizedText,
          offset: Number.isFinite(offset) ? offset : 0,
          }
        : {
          kind: "locator" as const,
          source: "chat" as const,
          sectionId: hit.chatId,
          title: hit.title,
          agent: hit.agent,
          updatedAt: hit.updatedAt,
          matched: "message" as const,
          messageSeq: hit.messageSeq ?? hit.message?.seq ?? 0,
          role: (hit.messageRole ?? hit.message?.role) === "user"
            ? "user" as const
            : "assistant" as const,
          normalizedText,
          offset: Number.isFinite(offset) ? offset : 0,
          };
      yield locatorHit(
        locator,
        destination,
        source.archivedChatDestinations[hit.chatId],
        hit.messageId ?? hit.message?.id
      );
    }
    if (page.nextCursor === null) break;
    cursor = page.nextCursor;
  }
  yield { kind: "lane-boundary", lane: "base" };
  for (const base of source.bases) {
    for (const event of scanBase(
      counter,
      { id: base.sectionId, title: base.title },
      base.ownerKey,
      base.snapshot,
      tokens
    )) {
      yield event.kind === "locator"
        ? locatorHit(
            event,
            source.archivedBaseDestinations[base.ownerKey]
              ? source.archivedBaseDestinations[base.ownerKey]!
              : { kind: "base", ownerKey: base.ownerKey },
            source.archivedBaseDestinations[base.ownerKey],
          )
        : event;
    }
  }
}

function locatorHit(
  locator: SearchLocator,
  destination: ProductDestination,
  archivedDestination?: ProductDestination,
  messageId?: string
): GlobalSearchHit {
  if (locator.source === "chat") {
    const targetDestination = archivedDestination ?? destination;
    return {
      key: `chat:${locator.sectionId}:${locator.matched}:${
        "messageSeq" in locator ? locator.messageSeq : 0
      }`,
      source: "chat",
      agent: locator.agent,
      title: locator.title ?? "Untitled chat",
      subtitle: locator.agent,
      snippet: makeSnippet(locator.normalizedText, locator.offset),
      route: archivedDestination
        ? productDestinationRoute(archivedDestination)
        : `/chat/${locator.sectionId}`,
      destination: targetDestination,
      updatedAt: locator.updatedAt,
      matched: locator.matched,
      ...(messageId && !archivedDestination
        ? { target: { kind: "chat-message" as const, messageId } }
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
    route: archivedDestination
      ? productDestinationRoute(archivedDestination)
      : owner.kind === "chat"
        ? `/bases/chat/${owner.chatId}`
        : `/bases/project/${owner.projectId}`,
    destination: archivedDestination ?? destination,
    updatedAt: 0,
    matched: locator.matched,
  };
}

function cursorOf(job: Pick<
  Job,
  "id" | "revision" | "deliveryEpoch" | "lane" | "lastIdentity"
>) {
  return Buffer.from(
    JSON.stringify({
      id: job.id,
      revision: job.revision,
      epoch: job.deliveryEpoch,
      lane: job.lane,
      lastIdentity: job.lastIdentity,
    })
  ).toString("base64url");
}

function sourceRevision(source: FrozenSource, chatRevision: number) {
  return createHash("sha256")
    .update(JSON.stringify({
      chatRevision,
      chatFences: source.chats.map((chat) => [
        chat.id,
        chat.chatRecordRevision,
        chat.chatMessageRevision,
        chat.incarnationId,
      ]),
      bases: source.bases.map((base) => [
        base.ownerKey,
        base.snapshot.meta.revision,
        base.snapshot.meta.rowsGeneration,
      ]),
      archivedChatDestinations: source.archivedChatDestinations,
      archivedBaseDestinations: source.archivedBaseDestinations,
    }))
    .digest("hex");
}

const archiveDestination = (
  target: "chat" | "project",
  id: string
): ProductDestination => ({ kind: "archive", target, id });

function isCheckpoint(value: StreamEvent): value is Checkpoint {
  return "kind" in value && value.kind === "checkpoint";
}

function isLaneBoundary(value: StreamEvent): value is LaneBoundary {
  return "kind" in value && value.kind === "lane-boundary";
}
