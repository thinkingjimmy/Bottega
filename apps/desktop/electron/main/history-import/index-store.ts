/**
 * [INPUT]: Depends on zod, Durable Json, shared history-import
 * [OUTPUT]: Provides history-index v1: Project visibility/Memory intent, per-source revision, file manifest, canonical Chat/generation route pointers with dangling-route forgetting, and legacy-divergence self-healing
 * [POS]: The history-import side of the product reads only index ledgers; Save only external source projections and fingerprints, not to transcribe CLI files or ChatStore
 */

import { join } from "node:path";
import { z } from "zod";
import { DurableJson } from "../persistence/durable-json";
import { HISTORY_SOURCE_KINDS, type HistoryFileFingerprint, type HistorySourceCount } from "../../../shared/history-import-ipc";
import type { AdapterEntry } from "./adapter";

const fingerprintSchema = z.object({
  device: z.string(), inode: z.string(), mtimeNs: z.string(), size: z.number().int().nonnegative(), parserVersion: z.number().int().positive(),
}).strict();
const keySchema = z.object({
  sourceKind: z.enum(HISTORY_SOURCE_KINDS), storageFingerprint: z.string().min(1),
  canonicalNativeId: z.string().min(1), aliases: z.array(z.string().min(1)), resumeAlias: z.string().min(1),
}).strict();
const entrySchema = z.object({
  opaqueId: z.string().min(1), projectId: z.string(), sourceKind: z.enum(HISTORY_SOURCE_KINDS), key: keySchema,
  title: z.string(), cwd: z.string(), createdAt: z.number().nonnegative(), updatedAt: z.number().nonnegative(),
  historyRevision: z.string().min(1), canResume: z.boolean(), archived: z.boolean(), incompleteTail: z.boolean(),
  sourceIncarnation: z.string().min(1), sourcePath: z.string().min(1), fingerprint: fingerprintSchema,
}).strict();
const countSchema = z.object({ sourceKind: z.enum(HISTORY_SOURCE_KINDS), installed: z.boolean(), count: z.number().int().nonnegative() }).strict();
const projectSchema = z.object({
  projectId: z.string().min(1), canonicalRoot: z.string().min(1), membershipRevision: z.number().int().nonnegative(),
  enabled: z.boolean(), memoryImportIntent: z.boolean().default(false), eligibilityRevision: z.number().int().nonnegative().default(0),
  generation: z.number().int().nonnegative(), hasChanges: z.boolean(),
  /* partialRecord：源枚举扩家（两家→四家）时旧档案缺新键仍合法读入，
   * 下次 publish 整体覆写即自愈——收紧 schema 不得把存量变成启动陷阱 */
  counts: z.array(countSchema), sourceRevisions: z.partialRecord(z.enum(HISTORY_SOURCE_KINDS), z.string()),
  entries: z.array(entrySchema), detectedFingerprints: z.record(z.string(), fingerprintSchema),
}).strict();
const canonicalRouteSchema = z.object({
  chatId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  generationId: z.string().min(1),
}).strict();
const stateSchema = z.object({
  schemaVersion: z.literal(1), revision: z.number().int().nonnegative(), projects: z.record(z.string(), projectSchema),
  canonicalRoutes: z.record(z.string(), canonicalRouteSchema).default({}),
}).strict();

export type IndexState = z.infer<typeof stateSchema>;
export type StoredHistoryProject = IndexState["projects"][string];
export type StoredCanonicalRoute = IndexState["canonicalRoutes"][string];

const empty = (): IndexState => ({ schemaVersion: 1, revision: 0, projects: {}, canonicalRoutes: {} });

export class HistoryImportIndexStore {
  private readonly ledger: DurableJson<IndexState>;

  constructor(userData: string) {
    this.ledger = new DurableJson(join(userData, "history-import", "index-v1.json"), stateSchema, empty);
  }

  /* 单步迁移：旧 v1 档案带两个已死字段——entry 上恒为 false 的 divergence，
   * 以及顶层 sessionPrefs 呈现 overlay（改名/归档已全部转交 canonical Chat）。
   * strict schema 收紧后旧档解析必失败，此处剥字段重发布一次即自愈；结构
   * 陌生的真损坏返回 undefined，维持 DurableJson 的 fail-closed 上抛。 */
  initialize() {
    return this.ledger.initialize((raw) => {
      if (!raw || typeof raw !== "object") return undefined;
      const cloned = structuredClone(raw) as {
        projects?: Record<string, { entries?: Array<Record<string, unknown>> }>;
        sessionPrefs?: unknown;
      };
      delete cloned.sessionPrefs;
      if (!cloned.projects || typeof cloned.projects !== "object") return undefined;
      for (const project of Object.values(cloned.projects)) {
        if (!Array.isArray(project?.entries)) return undefined;
        for (const entry of project.entries) delete entry.divergence;
      }
      const migrated = stateSchema.safeParse(cloned);
      return migrated.success ? migrated.data : undefined;
    });
  }
  snapshot() { return this.ledger.snapshot(); }

  project(projectId: string): StoredHistoryProject | undefined {
    return this.snapshot().projects[projectId];
  }

  setEnabled(input: { projectId: string; canonicalRoot: string; membershipRevision: number; enabled: boolean }) {
    return this.ledger.mutate((state) => {
      const current = state.projects[input.projectId];
      const eligibilityChanged = !current || current.enabled !== input.enabled ||
        current.canonicalRoot !== input.canonicalRoot || current.membershipRevision !== input.membershipRevision;
      state.projects[input.projectId] = current
        ? {
            ...current,
            canonicalRoot: input.canonicalRoot,
            membershipRevision: input.membershipRevision,
            enabled: input.enabled,
            eligibilityRevision: current.eligibilityRevision + (eligibilityChanged ? 1 : 0),
          }
        : {
            projectId: input.projectId, canonicalRoot: input.canonicalRoot, membershipRevision: input.membershipRevision,
            enabled: input.enabled, memoryImportIntent: false, eligibilityRevision: 1, generation: 0, hasChanges: input.enabled,
            counts: defaultCounts(), sourceRevisions: emptyRevisions(), entries: [], detectedFingerprints: {},
          };
      state.revision += 1;
    });
  }

  canonicalRoute(opaqueId: string): StoredCanonicalRoute | undefined {
    return this.snapshot().canonicalRoutes[opaqueId];
  }

  /* 路由指向的 Chat 一旦消失，这条指针就是一根断链：快照会把它投影成一条
     点不开的会话，而下一次同步又因为「已有路由」不肯重建。删掉即自愈。 */
  forgetCanonicalRoutes(
    predicate: (route: StoredCanonicalRoute, opaqueId: string) => boolean
  ) {
    return this.ledger.mutate((state) => {
      let changed = false;
      for (const [opaqueId, route] of Object.entries(state.canonicalRoutes)) {
        if (!predicate(route, opaqueId)) continue;
        delete state.canonicalRoutes[opaqueId];
        changed = true;
      }
      if (changed) state.revision += 1;
    });
  }

  recordCanonicalRoute(opaqueId: string, route: StoredCanonicalRoute) {
    return this.ledger.mutate((state) => {
      const current = state.canonicalRoutes[opaqueId];
      if (current?.chatId === route.chatId && current.generationId === route.generationId) return;
      state.canonicalRoutes[opaqueId] = route;
      state.revision += 1;
    });
  }

  setMemoryImportIntent(projectId: string, enabled: boolean) {
    return this.ledger.mutate((state) => {
      const current = state.projects[projectId];
      if (!current || current.memoryImportIntent === enabled) return;
      current.memoryImportIntent = enabled;
      state.revision += 1;
    });
  }

  publish(input: {
    projectId: string; canonicalRoot: string; membershipRevision: number; counts: HistorySourceCount[];
    sourceRevisions: Record<(typeof HISTORY_SOURCE_KINDS)[number], string>; entries: AdapterEntry[];
  }) {
    return this.ledger.mutate((state) => {
      const current = state.projects[input.projectId];
      const entries = input.entries.map((entry) => ({ ...entry, projectId: input.projectId }));
      state.projects[input.projectId] = {
        projectId: input.projectId, canonicalRoot: input.canonicalRoot, membershipRevision: input.membershipRevision,
        enabled: current?.enabled ?? true, memoryImportIntent: current?.memoryImportIntent ?? false,
        eligibilityRevision: (current?.eligibilityRevision ?? 1) + (
          current && (current.canonicalRoot !== input.canonicalRoot || current.membershipRevision !== input.membershipRevision) ? 1 : 0
        ),
        generation: (current?.generation ?? 0) + 1, hasChanges: false,
        counts: input.counts, sourceRevisions: input.sourceRevisions, entries,
        detectedFingerprints: Object.fromEntries(entries.map((entry) => [entry.sourcePath, entry.fingerprint])),
      };
      state.revision += 1;
    });
  }

  markDetected(projectId: string, input: { hasChanges: boolean; counts: HistorySourceCount[]; fingerprints: Record<string, HistoryFileFingerprint> }) {
    return this.ledger.mutate((state) => {
      const current = state.projects[projectId];
      if (!current) return;
      current.hasChanges = input.hasChanges;
      current.counts = input.counts;
      current.detectedFingerprints = input.fingerprints;
      state.revision += 1;
    });
  }

  removeMissing(validProjectIds: ReadonlySet<string>) {
    return this.ledger.mutate((state) => {
      let changed = false;
      for (const projectId of Object.keys(state.projects)) {
        if (validProjectIds.has(projectId)) continue;
        delete state.projects[projectId];
        changed = true;
      }
      if (changed) state.revision += 1;
    });
  }

  closeAndFlush() { return this.ledger.closeAndFlush(); }
}

const defaultCounts = (): HistorySourceCount[] => HISTORY_SOURCE_KINDS.map((sourceKind) => ({ sourceKind, installed: false, count: 0 }));
const emptyRevisions = () => Object.fromEntries(HISTORY_SOURCE_KINDS.map((kind) => [kind, ""])) as Record<(typeof HISTORY_SOURCE_KINDS)[number], string>;
