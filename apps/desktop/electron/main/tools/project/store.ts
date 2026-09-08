/**
 * [INPUT]: Depends on Node path, zod, the JsonCasStore persistence kernel, shared Project Tool policy contracts, and canonical Project ids
 * [OUTPUT]: Provides ProjectToolPolicyStore with strict schema, per-Project CAS tombstones, backup recovery, pruning, and retryable active+backup exact-owner cleanup
 * [POS]: Main-only source of truth for sticky Project built-in/global-MCP overrides; renderer never receives another Project's payload
 */

import { join } from "node:path";
import { z } from "zod";
import type {
  ProjectToolPolicyPayload,
  ToolOverride,
} from "../../../../shared/project-tools-ipc";
import { PROJECT_ID_PATTERN } from "../../../../shared/projects-ipc";
import {
  JsonCasStore,
  byteLength,
  serialize,
  storeError,
  type JsonCasStoreDependencies,
} from "../json-cas-store";

const SCHEMA_VERSION = 1;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_PROJECT_BYTES = 16 * 1024;
const MAX_PROJECTS = 2_048;
const MAX_OVERRIDES_PER_PROJECT = 512;
const TOOL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const MANUAL_ID = /^manual:[a-z0-9]+(?:-[a-z0-9]+)*$/;

const overrideSchema = z.enum(["enabled", "disabled"]);
const payloadSchema = z
  .object({
    builtinOverrides: z.record(z.string(), overrideSchema),
    globalMcpOverrides: z.record(z.string(), overrideSchema),
  })
  .strict();
const fileSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    revision: z.number().int().nonnegative(),
    projectRevisions: z.record(z.string(), z.number().int().nonnegative()),
    policies: z.record(z.string(), payloadSchema),
  })
  .strict();

type StoreFile = z.infer<typeof fileSchema>;
type MutablePayload = z.infer<typeof payloadSchema>;

export type ProjectPolicyStoreSnapshot = Readonly<{
  storeRevision: number;
  projectRevision: number;
  policy: ProjectToolPolicyPayload;
}>;

export type ProjectPolicyStoreChangedEvent = Readonly<{
  projectId: string;
  projectPolicyRevision: number;
  storeRevision: number;
}>;

export type ProjectToolPolicyStoreDependencies = JsonCasStoreDependencies &
  Readonly<{
    globalMcpServerExists?: (serverId: `manual:${string}`) => boolean;
  }>;

const EMPTY_POLICY: MutablePayload = {
  builtinOverrides: {},
  globalMcpOverrides: {},
};
const emptyFile = (): StoreFile => ({
  schemaVersion: SCHEMA_VERSION,
  revision: 0,
  projectRevisions: {},
  policies: {},
});

export class ProjectToolPolicyStore extends JsonCasStore<StoreFile, ProjectPolicyStoreChangedEvent> {
  constructor(
    userData: string,
    private readonly dependencies: ProjectToolPolicyStoreDependencies = {}
  ) {
    super({
      filePath: join(userData, "project-tool-policies.json"),
      label: "Project Tool Policy",
      maxFileBytes: MAX_FILE_BYTES,
      empty: emptyFile,
      validate: validateFile,
      dependencies,
    });
  }

  initialize() {
    return this.mutate(async () => {
      await this.recover();
      await this.pruneMissingGlobalMcpOverrides();
      return structuredClone(this.state);
    });
  }

  project(projectId: string): ProjectPolicyStoreSnapshot {
    assertProjectId(projectId);
    return {
      storeRevision: this.state.revision,
      projectRevision: this.state.projectRevisions[projectId] ?? 0,
      policy: structuredClone(this.state.policies[projectId] ?? EMPTY_POLICY),
    };
  }

  setBuiltinOverride(
    projectId: string,
    expectedRevision: number,
    toolId: string,
    override: ToolOverride
  ) {
    assertToolId(toolId);
    return this.update(projectId, expectedRevision, (policy) => {
      policy.builtinOverrides[toolId] = overrideSchema.parse(override);
    });
  }

  resetBuiltinOverride(projectId: string, expectedRevision: number, toolId: string) {
    assertToolId(toolId);
    return this.update(projectId, expectedRevision, (policy) => {
      delete policy.builtinOverrides[toolId];
    });
  }

  setGlobalMcpOverride(
    projectId: string,
    expectedRevision: number,
    serverId: string,
    override: ToolOverride
  ) {
    assertManualId(serverId);
    if (
      this.dependencies.globalMcpServerExists &&
      !this.dependencies.globalMcpServerExists(serverId)
    ) {
      throw storeError("owner-mismatch", "global MCP server 不存在");
    }
    return this.update(projectId, expectedRevision, (policy) => {
      policy.globalMcpOverrides[serverId] = overrideSchema.parse(override);
    });
  }

  resetGlobalMcpOverride(projectId: string, expectedRevision: number, serverId: string) {
    assertManualId(serverId);
    return this.update(projectId, expectedRevision, (policy) => {
      delete policy.globalMcpOverrides[serverId];
    });
  }

  resetAll(projectId: string, expectedRevision: number) {
    return this.update(projectId, expectedRevision, (policy) => {
      policy.builtinOverrides = {};
      policy.globalMcpOverrides = {};
    });
  }

  pruneGlobalMcpServer(serverId: string) {
    assertManualId(serverId);
    return this.mutate(async () => {
      const affected = Object.entries(this.state.policies)
        .filter(([, policy]) => Object.hasOwn(policy.globalMcpOverrides, serverId))
        .map(([projectId]) => projectId);
      if (!affected.length) return [];
      const policies = structuredClone(this.state.policies);
      const projectRevisions = { ...this.state.projectRevisions };
      for (const projectId of affected) {
        delete policies[projectId]!.globalMcpOverrides[serverId];
        if (isEmpty(policies[projectId]!)) delete policies[projectId];
        projectRevisions[projectId] = (projectRevisions[projectId] ?? 0) + 1;
      }
      return this.commit({ policies, projectRevisions }, affected);
    });
  }

  cleanupProject(projectId: string) {
    assertProjectId(projectId);
    return this.mutate(async () => {
      const hasPayload = Object.hasOwn(this.state.policies, projectId);
      const hasRevision = Object.hasOwn(this.state.projectRevisions, projectId);
      if (hasPayload || hasRevision) {
        const policies = { ...this.state.policies };
        const projectRevisions = { ...this.state.projectRevisions };
        delete policies[projectId];
        delete projectRevisions[projectId];
        await this.commit({ policies, projectRevisions }, []);
      }
      await this.rewriteBackup();
      return hasPayload || hasRevision;
    });
  }

  private update(
    projectId: string,
    expectedRevision: number,
    edit: (payload: MutablePayload) => void
  ) {
    assertProjectId(projectId);
    return this.mutate(async () => {
      this.assertRevision(projectId, expectedRevision);
      const policies = structuredClone(this.state.policies);
      const policy = structuredClone(policies[projectId] ?? EMPTY_POLICY);
      edit(policy);
      if (this.dependencies.globalMcpServerExists) {
        for (const serverId of Object.keys(policy.globalMcpOverrides)) {
          assertManualId(serverId);
          if (!this.dependencies.globalMcpServerExists(serverId)) {
            delete policy.globalMcpOverrides[serverId];
          }
        }
      }
      if (isEmpty(policy)) delete policies[projectId];
      else policies[projectId] = policy;
      const projectRevisions = {
        ...this.state.projectRevisions,
        [projectId]: expectedRevision + 1,
      };
      await this.commit({ policies, projectRevisions }, [projectId]);
      return this.project(projectId);
    });
  }

  private assertRevision(projectId: string, expected: number) {
    if (!Number.isInteger(expected) || expected < 0) {
      throw new Error("Project Policy revision 无效");
    }
    if ((this.state.projectRevisions[projectId] ?? 0) !== expected) {
      throw storeError("scope-revision-conflict", "Project Policy 已变化，请刷新后重试");
    }
  }

  private async pruneMissingGlobalMcpOverrides() {
    const exists = this.dependencies.globalMcpServerExists;
    if (!exists) return;
    const policies = structuredClone(this.state.policies);
    const projectRevisions = { ...this.state.projectRevisions };
    const affected: string[] = [];
    for (const [projectId, policy] of Object.entries(policies)) {
      let changed = false;
      for (const serverId of Object.keys(policy.globalMcpOverrides)) {
        assertManualId(serverId);
        if (exists(serverId)) continue;
        delete policy.globalMcpOverrides[serverId];
        changed = true;
      }
      if (!changed) continue;
      affected.push(projectId);
      projectRevisions[projectId] = (projectRevisions[projectId] ?? 0) + 1;
      if (isEmpty(policy)) delete policies[projectId];
    }
    if (affected.length) await this.commit({ policies, projectRevisions }, affected);
  }

  private async commit(
    changed: Pick<StoreFile, "policies" | "projectRevisions">,
    affectedProjects: readonly string[]
  ) {
    const next = validateFile({
      schemaVersion: SCHEMA_VERSION,
      revision: this.state.revision + 1,
      ...changed,
    });
    const events = affectedProjects.map((projectId) => ({
      projectId,
      projectPolicyRevision: next.projectRevisions[projectId] ?? 0,
      storeRevision: next.revision,
    }));
    await this.commitState(next, events);
    return events;
  }
}

function validateFile(raw: unknown): StoreFile {
  const state = fileSchema.parse(raw);
  const projectIds = new Set([
    ...Object.keys(state.projectRevisions),
    ...Object.keys(state.policies),
  ]);
  if (projectIds.size > MAX_PROJECTS) throw new Error(`Project Policy 最多 ${MAX_PROJECTS} 个`);
  for (const projectId of projectIds) assertProjectId(projectId);
  for (const [projectId, policy] of Object.entries(state.policies)) {
    if (!Object.hasOwn(state.projectRevisions, projectId)) {
      throw new Error(`Project Policy 缺少 revision：${projectId}`);
    }
    for (const toolId of Object.keys(policy.builtinOverrides)) assertToolId(toolId);
    for (const serverId of Object.keys(policy.globalMcpOverrides)) assertManualId(serverId);
    const count = Object.keys(policy.builtinOverrides).length + Object.keys(policy.globalMcpOverrides).length;
    if (count > MAX_OVERRIDES_PER_PROJECT) throw new Error(`Project ${projectId} override 过多`);
    if (byteLength(JSON.stringify(policy)) > MAX_PROJECT_BYTES) {
      throw new Error(`Project ${projectId} Policy 超过单项字节预算`);
    }
  }
  if (byteLength(serialize(state)) > MAX_FILE_BYTES) throw new Error("Project Policy 超过总字节预算");
  return state;
}

function assertProjectId(projectId: string) {
  if (!PROJECT_ID_PATTERN.test(projectId)) throw new Error("Project id 无效");
}

function assertToolId(toolId: string) {
  if (!TOOL_ID.test(toolId)) throw new Error("内置工具 id 无效");
}

function assertManualId(serverId: string): asserts serverId is `manual:${string}` {
  if (!MANUAL_ID.test(serverId)) throw new Error("MCP serverId 无效");
}

function isEmpty(policy: MutablePayload) {
  return !Object.keys(policy.builtinOverrides).length && !Object.keys(policy.globalMcpOverrides).length;
}
