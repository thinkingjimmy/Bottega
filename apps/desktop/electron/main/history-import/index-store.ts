/**
 * [INPUT]: Depends on zod, Durable Json, shared history-import
 * [OUTPUT]: Provides history-index v1: Project visibility/Memory intent, single-mode eligibility revision, per-source revision, file manifest, detection mode and atom generation release, and sessionPrefs overlay ((per-opaqueId title override and product side archivedAt)
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
  historyRevision: z.string().min(1), canResume: z.boolean(), archived: z.boolean(), incompleteTail: z.boolean(), divergence: z.boolean(),
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
/* ── 产品侧会话呈现偏好：独立于 publish 的 overlay 档案 ─────────────
 * entries 每次刷新被扫描整体替换，rename/归档若写进 entry 就活不过下一次
 * 刷新；prefs 以 opaqueId 为键独立存放，投影时合成。CLI 源文件只读，
 * 归档与改名因此天然只是产品侧视图状态。 */
const sessionPrefSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  archivedAt: z.number().nonnegative().optional(),
}).strict();
const stateSchema = z.object({
  schemaVersion: z.literal(1), revision: z.number().int().nonnegative(), projects: z.record(z.string(), projectSchema),
  sessionPrefs: z.record(z.string(), sessionPrefSchema).default({}),
}).strict();

type IndexState = z.infer<typeof stateSchema>;
export type StoredHistoryProject = IndexState["projects"][string];
export type StoredSessionPref = IndexState["sessionPrefs"][string];

const empty = (): IndexState => ({ schemaVersion: 1, revision: 0, projects: {}, sessionPrefs: {} });

export class HistoryImportIndexStore {
  private readonly ledger: DurableJson<IndexState>;

  constructor(userData: string) {
    this.ledger = new DurableJson(join(userData, "history-import", "index-v1.json"), stateSchema, empty);
  }

  initialize() { return this.ledger.initialize(); }
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

  sessionPref(opaqueId: string): StoredSessionPref | undefined {
    return this.snapshot().sessionPrefs[opaqueId];
  }

  renameSession(opaqueId: string, title: string) {
    return this.ledger.mutate((state) => {
      const current = state.sessionPrefs[opaqueId];
      if (current?.title === title) return;
      state.sessionPrefs[opaqueId] = { ...current, title };
      state.revision += 1;
    });
  }

  setSessionArchived(opaqueId: string, archived: boolean) {
    return this.ledger.mutate((state) => {
      const current = state.sessionPrefs[opaqueId];
      if (archived === Boolean(current?.archivedAt)) return;
      const next = { ...current, archivedAt: archived ? Date.now() : undefined };
      if (!archived) delete next.archivedAt;
      if (next.title === undefined && next.archivedAt === undefined) delete state.sessionPrefs[opaqueId];
      else state.sessionPrefs[opaqueId] = next;
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
