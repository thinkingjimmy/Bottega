/**
 * [INPUT]: Depends on Node crypto/filesystem, neutral Project resource scope, builtin tool names, manual MCP eligibility, and shared backend/runtime transport support
 * [OUTPUT]: Provides durable FrozenProjectToolsReceipt construction, hash-sealed MCP candidate staging/hydration, receipt verification, runtime-filtered candidates, and stable session-plan digests
 * [POS]: Main-only Project Tools custody boundary; secrets live in the staged blob while the durable relay payload keeps only identities, scopes, revisions, and digests
 */

import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentBackendId } from "../../../../../shared/agent-ipc";
import type { BuiltinToolName } from "../../../../../shared/builtin-tools";
import type { ManualMcpEligibility } from "../../../../../shared/mcp-servers-ipc";
import type {
  ProductResourceScope,
  ScopedResourceVersion,
  TurnProjectContext,
} from "../../../../../shared/resource-scope";
import {
  resolveManualMcpBackendSupport,
  toolBackendFactsFromRuntimeIdentity,
} from "../../../../../shared/tool-support";
import { canonicalHash } from "../coordinator-values";

export type FrozenManualMcpCandidate = Readonly<{
  serverId: `manual:${string}`;
  displayName: string;
  scope: ProductResourceScope;
  enabled: boolean;
  eligibility: ManualMcpEligibility;
  configDigest: `sha256:${string}`;
  config:
    | Readonly<{
        transport: "stdio";
        command: string;
        args: readonly string[];
        env: Readonly<Record<string, string>>;
      }>
    | Readonly<{
        transport: "streamable-http" | "sse";
        url: string;
        headers: Readonly<Record<string, string>>;
      }>;
}>;

export type ProjectToolsPreparationSnapshot = Readonly<{
  projectContext: TurnProjectContext;
  resourceVersion: ScopedResourceVersion;
  policyRevisions: Readonly<{
    global: number;
    project: number | null;
  }>;
  mcpScopeRevisions: Readonly<{
    global: number;
    project: number | null;
  }>;
  builtinIntent: Readonly<{
    disabledTools: readonly BuiltinToolName[];
  }>;
  /** Preparation-time runtime projection used by explicit Skill requirements. */
  allowedTools: readonly BuiltinToolName[];
  mcpCandidates: readonly FrozenManualMcpCandidate[];
}>;

export type ExplicitSkillRequirementReceipt = Readonly<{
  ref: string;
  name: string;
  requirement: string | null;
  allowedToolsDigest: string;
}>;

export type SealedMcpCandidatesRef = Readonly<{
  blobId: string;
  path: string;
  byteSize: number;
  sha256: string;
  candidates: readonly Readonly<{
    serverId: `manual:${string}`;
    displayName: string;
    scope: ProductResourceScope;
    enabled: boolean;
    eligibility: ManualMcpEligibility;
    configDigest: `sha256:${string}`;
  }>[];
}>;

export type FrozenProjectToolsReceipt = Readonly<{
  schemaVersion: 1;
  projectContext: TurnProjectContext;
  resourceVersion: ScopedResourceVersion;
  policyRevisions: ProjectToolsPreparationSnapshot["policyRevisions"];
  mcpScopeRevisions: ProjectToolsPreparationSnapshot["mcpScopeRevisions"];
  builtinIntent: ProjectToolsPreparationSnapshot["builtinIntent"];
  allowedTools: readonly BuiltinToolName[];
  manualMcpDecisions: SealedMcpCandidatesRef["candidates"];
  explicitSkills: readonly ExplicitSkillRequirementReceipt[];
  sealedMcpCandidates: SealedMcpCandidatesRef;
  digest: string;
}>;

export type HydratedProjectTools = Readonly<{
  receipt: FrozenProjectToolsReceipt;
  candidates: readonly FrozenManualMcpCandidate[];
  sessionPlanDigest: string;
}>;

type Quota = Readonly<{
  reserve(bytes: number): Promise<void>;
  release(bytes: number): Promise<void>;
}>;

const sha256 = (content: Uint8Array | string) =>
  createHash("sha256").update(content).digest("hex");

const scopeKey = (scope: ProductResourceScope) =>
  scope.kind === "global" ? "global" : `project:${scope.projectId}`;

const canonicalCandidates = (
  candidates: readonly FrozenManualMcpCandidate[]
) => [...candidates]
  .map((candidate) => structuredClone(candidate))
  .sort((left, right) =>
    `${scopeKey(left.scope)}\0${left.serverId}`.localeCompare(
      `${scopeKey(right.scope)}\0${right.serverId}`
    )
  );

export async function stageProjectToolsReceipt(input: Readonly<{
  stagingDir: string;
  snapshot: ProjectToolsPreparationSnapshot;
  explicitSkills: readonly ExplicitSkillRequirementReceipt[];
  quota: Quota;
}>): Promise<FrozenProjectToolsReceipt> {
  const candidates = canonicalCandidates(input.snapshot.mcpCandidates);
  const content = Buffer.from(JSON.stringify({ schemaVersion: 1, candidates }));
  await input.quota.reserve(content.byteLength);
  const blobId = randomUUID();
  const path = join(input.stagingDir, `${blobId}-project-tools.json`);
  try {
    await writeFile(path, content, { flag: "wx", mode: 0o400 });
  } catch (cause) {
    await input.quota.release(content.byteLength);
    throw cause;
  }
  const decisions = candidates.map((candidate) => ({
    serverId: candidate.serverId,
    displayName: candidate.displayName,
    scope: candidate.scope,
    enabled: candidate.enabled,
    eligibility: candidate.eligibility,
    configDigest: candidate.configDigest,
  }));
  const sealedMcpCandidates = {
    blobId,
    path,
    byteSize: content.byteLength,
    sha256: sha256(content),
    candidates: decisions,
  } satisfies SealedMcpCandidatesRef;
  const base = {
    schemaVersion: 1 as const,
    projectContext: structuredClone(input.snapshot.projectContext),
    resourceVersion: structuredClone(input.snapshot.resourceVersion),
    policyRevisions: structuredClone(input.snapshot.policyRevisions),
    mcpScopeRevisions: structuredClone(input.snapshot.mcpScopeRevisions),
    builtinIntent: {
      disabledTools: [...input.snapshot.builtinIntent.disabledTools].sort(),
    },
    allowedTools: [...input.snapshot.allowedTools].sort(),
    manualMcpDecisions: decisions,
    explicitSkills: [...input.explicitSkills],
    sealedMcpCandidates,
  };
  return { ...base, digest: canonicalHash(base) };
}

export function assertProjectToolsReceipt(receipt: FrozenProjectToolsReceipt) {
  if (!receipt || receipt.schemaVersion !== 1) {
    throw new Error("PROJECT_TOOLS_RECEIPT_MISSING");
  }
  const { digest, ...base } = receipt;
  if (digest !== canonicalHash(base)) {
    throw new Error("PROJECT_TOOLS_RECEIPT_HASH_MISMATCH");
  }
  if (
    receipt.projectContext.projectId !== null &&
    receipt.resourceVersion.scope.kind !== "project"
  ) {
    throw new Error("PROJECT_TOOLS_SCOPE_MISMATCH");
  }
  if (
    receipt.projectContext.projectId === null &&
    receipt.resourceVersion.scope.kind !== "global"
  ) {
    throw new Error("PROJECT_TOOLS_SCOPE_MISMATCH");
  }
}

export async function hydrateProjectToolsReceipt(
  receipt: FrozenProjectToolsReceipt,
  backendId: AgentBackendId,
  planMode: boolean,
  backendRuntimeIdentity?: string,
  allowTextOnlyHarness = false
): Promise<HydratedProjectTools> {
  assertProjectToolsReceipt(receipt);
  if (allowTextOnlyHarness && receipt.sealedMcpCandidates.path === "") {
    return {
      receipt,
      candidates: [],
      sessionPlanDigest: manualSessionPlanDigest({
        backendId,
        projectContext: receipt.projectContext,
        planMode,
        candidates: [],
        backendRuntimeIdentity,
      }),
    };
  }
  let content: Buffer;
  try {
    content = await readFile(receipt.sealedMcpCandidates.path);
  } catch (cause) {
    throw new Error("PROJECT_TOOLS_BLOB_MISSING", { cause });
  }
  if (
    content.byteLength !== receipt.sealedMcpCandidates.byteSize ||
    sha256(content) !== receipt.sealedMcpCandidates.sha256
  ) {
    throw new Error("PROJECT_TOOLS_BLOB_HASH_MISMATCH");
  }
  const parsed = parseCandidates(content);
  const candidates = canonicalCandidates(parsed);
  for (const candidate of candidates) {
    if (
      candidate.scope.kind === "project" &&
      candidate.scope.projectId !== receipt.projectContext.projectId
    ) {
      throw new Error("PROJECT_TOOLS_BLOB_SCOPE_MISMATCH");
    }
  }
  const metadata = candidates.map((candidate) => ({
    serverId: candidate.serverId,
    displayName: candidate.displayName,
    scope: candidate.scope,
    enabled: candidate.enabled,
    eligibility: candidate.eligibility,
    configDigest: candidate.configDigest,
  }));
  if (canonicalHash(metadata) !== canonicalHash(receipt.manualMcpDecisions)) {
    throw new Error("PROJECT_TOOLS_BLOB_IDENTITY_MISMATCH");
  }
  return {
    receipt,
    candidates,
    sessionPlanDigest: manualSessionPlanDigest({
      backendId,
      projectContext: receipt.projectContext,
      planMode,
      candidates,
      backendRuntimeIdentity,
    }),
  };
}

export function manualSessionPlanDigest(input: Readonly<{
  backendId: AgentBackendId;
  backendRuntimeIdentity?: string;
  projectContext: TurnProjectContext;
  planMode: boolean;
  candidates: readonly FrozenManualMcpCandidate[];
}>) {
  const entries = input.planMode
    ? []
    : supportedManualMcpCandidates(input)
      .map((candidate) => ({
        identity: candidate.serverId,
        scope: scopeKey(candidate.scope),
        configDigest: candidate.configDigest,
      }));
  return sha256(JSON.stringify({
    backendId: input.backendId,
    projectContext: input.projectContext,
    entries,
  }));
}

export function supportedManualMcpCandidates(input: Readonly<{
  backendId: AgentBackendId;
  backendRuntimeIdentity?: string;
  candidates: readonly FrozenManualMcpCandidate[];
}>) {
  const backend = toolBackendFactsFromRuntimeIdentity(
    input.backendId,
    input.backendRuntimeIdentity
  );
  return canonicalCandidates(input.candidates).filter((candidate) =>
    candidate.enabled &&
    candidate.eligibility === "eligible" &&
    resolveManualMcpBackendSupport(candidate.config.transport, backend).supported
  );
}

function parseCandidates(content: Buffer): FrozenManualMcpCandidate[] {
  let value: unknown;
  try {
    value = JSON.parse(content.toString("utf8"));
  } catch (cause) {
    throw new Error("PROJECT_TOOLS_BLOB_INVALID", { cause });
  }
  if (!value || typeof value !== "object") {
    throw new Error("PROJECT_TOOLS_BLOB_INVALID");
  }
  const record = value as { schemaVersion?: unknown; candidates?: unknown };
  if (record.schemaVersion !== 1 || !Array.isArray(record.candidates)) {
    throw new Error("PROJECT_TOOLS_BLOB_INVALID");
  }
  return record.candidates.map(parseCandidate);
}

function parseCandidate(value: unknown): FrozenManualMcpCandidate {
  if (!value || typeof value !== "object") {
    throw new Error("PROJECT_TOOLS_BLOB_INVALID");
  }
  const candidate = value as FrozenManualMcpCandidate;
  if (
    !/^manual:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate.serverId) ||
    typeof candidate.displayName !== "string" ||
    typeof candidate.enabled !== "boolean" ||
    !candidate.scope ||
    !candidate.config ||
    !candidate.configDigest?.startsWith("sha256:")
  ) {
    throw new Error("PROJECT_TOOLS_BLOB_INVALID");
  }
  if (
    candidate.scope.kind !== "global" &&
    (candidate.scope.kind !== "project" || !candidate.scope.projectId)
  ) {
    throw new Error("PROJECT_TOOLS_BLOB_INVALID");
  }
  if (candidate.config.transport === "stdio") {
    if (
      typeof candidate.config.command !== "string" ||
      !Array.isArray(candidate.config.args) ||
      !candidate.config.env ||
      typeof candidate.config.env !== "object"
    ) {
      throw new Error("PROJECT_TOOLS_BLOB_INVALID");
    }
  } else if (
    !["streamable-http", "sse"].includes(candidate.config.transport) ||
    typeof candidate.config.url !== "string" ||
    !candidate.config.headers ||
    typeof candidate.config.headers !== "object"
  ) {
    throw new Error("PROJECT_TOOLS_BLOB_INVALID");
  }
  return structuredClone(candidate);
}

export function emptyProjectToolsSnapshot(
  projectContext: TurnProjectContext = {
    projectId: null,
    projectLifecycleRevision: null,
  }
): ProjectToolsPreparationSnapshot {
  const projectId = projectContext.projectId;
  return {
    projectContext: structuredClone(projectContext),
    resourceVersion: {
      scope: projectId === null
        ? { kind: "global" }
        : { kind: "project", projectId },
      projectLifecycleRevision: projectContext.projectLifecycleRevision,
      scopeRevision: 0,
    },
    policyRevisions: { global: 0, project: projectId === null ? null : 0 },
    mcpScopeRevisions: { global: 0, project: projectId === null ? null : 0 },
    builtinIntent: { disabledTools: [] },
    allowedTools: [],
    mcpCandidates: [],
  };
}

/** Synchronous text-only harness used by existing coordinator unit fixtures. */
export function emptyProjectToolsReceipt(
  projectContext?: TurnProjectContext
): FrozenProjectToolsReceipt {
  const snapshot = emptyProjectToolsSnapshot(projectContext);
  const base = {
    schemaVersion: 1 as const,
    projectContext: snapshot.projectContext,
    resourceVersion: snapshot.resourceVersion,
    policyRevisions: snapshot.policyRevisions,
    mcpScopeRevisions: snapshot.mcpScopeRevisions,
    builtinIntent: snapshot.builtinIntent,
    allowedTools: snapshot.allowedTools,
    manualMcpDecisions: [],
    explicitSkills: [],
    sealedMcpCandidates: {
      blobId: "text-only-harness",
      path: "",
      byteSize: 0,
      sha256: sha256(JSON.stringify({ schemaVersion: 1, candidates: [] })),
      candidates: [],
    },
  };
  return { ...base, digest: canonicalHash(base) };
}
