/**
 * [INPUT]: Depends on durable-json, PluginDataEpochStore and package generation identity
 * [OUTPUT]: Provides McpServerCustodyLedger: connector-before-activation, durable writer lease, accurate exit release and crash quarantine
 * [POS]: The truth about per-server custody of extensions/lifecycle; P3 supervisor remains unopened as proof of zero authority or quarantine of unloading/data gate
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import type { AgentBackendId } from "../../../../shared/agent-ipc";
import {
  SHA256_DIGEST_IDENTITY_PATTERN,
  type ExtensionPackageGenerationRef,
} from "../../../../shared/extensions-ipc";
import { DurableJson } from "../../persistence/durable-json";
import type { PluginDataEpochStore } from "./plugin-data-epochs";

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identity = z.string().regex(SHA256_DIGEST_IDENTITY_PATTERN);
const entrySchema = z.object({
  custodyId: z.string().uuid(),
  planInstanceId: z.string().min(1),
  sourceIdentity: identity,
  generationRef: z.object({
    packageGenerationId: z.string().min(1),
    recordDigest: digest,
  }).strict(),
  installIdentity: identity,
  pluginDataEpochId: z.string().min(1),
  resolvedConfigDigest: digest,
  backend: z.enum(["codex", "claude", "kimi", "opencode"]),
  phase: z.enum([
    "intent",
    "connector-attached",
    "activation-authorized",
    "active",
    "release-pending",
    "released",
    "quarantined",
  ]),
  revision: z.number().int().nonnegative(),
  writerLeaseId: z.string().uuid().optional(),
}).strict();
const fileSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  entries: z.array(entrySchema),
}).strict();

type File = z.infer<typeof fileSchema>;
type Entry = File["entries"][number];
type Phase = Entry["phase"];

export class McpServerCustodyLedger {
  private readonly file: DurableJson<File>;

  constructor(userData: string, private readonly epochs: PluginDataEpochStore) {
    this.file = new DurableJson(
      join(userData, "agent-extensions", "mcp-server-custody.json"),
      fileSchema,
      () => ({ schemaVersion: 1, revision: 0, entries: [] })
    );
  }

  initialize() {
    return this.file.initialize();
  }

  createIntent(input: {
    planInstanceId: string;
    sourceIdentity: string;
    generationRef: ExtensionPackageGenerationRef;
    installIdentity: string;
    pluginDataEpochId: string;
    resolvedConfigDigest: `sha256:${string}`;
    backend: AgentBackendId;
  }) {
    return this.file.mutate((state) => {
      const entry = entrySchema.parse({
        ...input,
        custodyId: randomUUID(),
        phase: "intent",
        revision: 0,
      });
      state.entries.push(entry);
      state.revision += 1;
      return entry;
    });
  }

  attachConnector(custodyId: string, revision: number) {
    return this.advance(custodyId, revision, "intent", "connector-attached");
  }

  /** writer identity 先 fsync 入 custody，再重建内存 gate；反序会留下无主 writer。 */
  async authorizeActivation(custodyId: string, revision: number) {
    const writerLeaseId = randomUUID();
    const entry = await this.file.mutate((state) => {
      const current = requireEntry(state, custodyId, revision, "connector-attached");
      current.phase = "activation-authorized";
      current.writerLeaseId = writerLeaseId;
      current.revision += 1;
      state.revision += 1;
      return current;
    });
    this.epochs.restoreWriter(
      writerLeaseId,
      entry.installIdentity,
      entry.pluginDataEpochId
    );
    return entry;
  }

  markActive(custodyId: string, revision: number) {
    return this.advance(custodyId, revision, "activation-authorized", "active");
  }

  beginRelease(custodyId: string, revision: number) {
    const entry = this.get(custodyId);
    if (!entry || !["activation-authorized", "active", "quarantined"].includes(entry.phase)) {
      throw new Error("MCP custody 尚未激活，不能进入 release-pending");
    }
    return this.advance(custodyId, revision, entry.phase, "release-pending");
  }

  /** 只有 supervisor 精确观察到真实 child 退出后才能调用。 */
  async recordExactExit(custodyId: string, revision: number) {
    const entry = await this.advance(custodyId, revision, "release-pending", "released");
    if (entry.writerLeaseId) this.epochs.releaseWriter(entry.writerLeaseId);
    return entry;
  }

  /**
   * 当前版本没有围栏外 supervisor 接管口：pre-activation 可证明没 spawn，直接
   * released；其余一律恢复 writer 后 quarantine，绝不用超时冒充死亡证据。
   */
  async reconcile() {
    for (const entry of this.file.snapshot().entries) {
      if (entry.phase === "released") continue;
      if (entry.phase === "intent" || entry.phase === "connector-attached") {
        await this.advance(entry.custodyId, entry.revision, entry.phase, "released");
        continue;
      }
      if (!entry.writerLeaseId) throw new Error("激活后的 MCP custody 缺 writer lease");
      this.epochs.restoreWriter(
        entry.writerLeaseId,
        entry.installIdentity,
        entry.pluginDataEpochId
      );
      if (entry.phase !== "quarantined") {
        await this.advance(entry.custodyId, entry.revision, entry.phase, "quarantined");
      }
    }
  }

  outstanding(installIdentity: string) {
    return this.file.snapshot().entries
      .filter((entry) => entry.installIdentity === installIdentity && entry.phase !== "released")
      .map((entry) => entry.custodyId);
  }

  get(custodyId: string) {
    return this.file.snapshot().entries.find((entry) => entry.custodyId === custodyId);
  }

  snapshot() {
    return this.file.snapshot();
  }

  private advance(
    custodyId: string,
    revision: number,
    from: Phase,
    to: Phase
  ) {
    return this.file.mutate((state) => {
      const entry = requireEntry(state, custodyId, revision, from);
      entry.phase = to;
      entry.revision += 1;
      state.revision += 1;
      return entry;
    });
  }
}

function requireEntry(state: File, custodyId: string, revision: number, phase: Phase) {
  const entry = state.entries.find((item) => item.custodyId === custodyId);
  if (!entry) throw new Error("MCP server custody 不存在");
  if (entry.revision !== revision || entry.phase !== phase) {
    throw new Error("MCP_SERVER_CUSTODY_REVISION_MISMATCH");
  }
  return entry;
}
