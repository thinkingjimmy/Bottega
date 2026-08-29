/**
 * [INPUT]: Depends on Node fs/path/crypto, zod and shared Base GUI generation/access identity
 * [OUTPUT]: Provides BaseGuiGrantStore: stable decision, exact generation capability set, self-administered approved state, append-only revoke tombstone, durable revision CAS and freezing air after damage/disruption
 * [POS]: authorized copywriter of apps/base-gui; The manifest only requests, and the active GUI writes only from the exact approved decision of the ledger
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type {
  BaseGuiCapability,
  BaseGuiCapabilityDecision,
  BaseGuiCapabilityScopes,
  BaseGuiHostActionCapability,
} from "../../../../shared/apps-ipc";
import {
  DurableFileCorruptionError,
  quarantineDurableFile,
} from "../../persistence/durable-json";

const digestSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/)
  .transform((value) => value as `sha256:${string}`);

const decisionSchema: z.ZodType<BaseGuiCapabilityDecision> = z
  .object({
    decisionId: z.string().uuid(),
    revision: z.number().int().positive(),
    appId: z.string().regex(/^[a-z0-9]{10}$/),
    generationId: z.string().min(1),
    contentDigest: digestSchema,
    expectedActiveGenerationId: z.string().min(1).nullable(),
    requestedCapabilities: z.array(z.enum(["row-insert", "row-patch", "row-delete", "attachment-read", "workspace-read"])).max(5),
    grantedCapabilities: z.array(z.enum(["row-insert", "row-patch", "row-delete", "attachment-read", "workspace-read"])).max(5),
    requestedHostActions: z.array(z.enum(["compose-text"])).max(1).default([]),
    grantedHostActions: z.array(z.enum(["compose-text"])).max(1).default([]),
    requestedCapabilityScopes: z
      .object({ workspaceRead: z.literal("design/").optional() })
      .strict()
      .default({}),
    grantedCapabilityScopes: z
      .object({ workspaceRead: z.literal("design/").optional() })
      .strict()
      .default({}),
    state: z.enum(["consent-required", "approved", "declined"]),
  })
  .strict()
  .superRefine((decision, context) => {
    const requested = new Set(decision.requestedCapabilities);
    const requestedHostActions = new Set(decision.requestedHostActions);
    if (decision.grantedCapabilities.some((capability) => !requested.has(capability))) {
      context.addIssue({ code: "custom", message: "Base GUI grant 必须是 requested capability 的子集" });
    }
    if (decision.grantedHostActions.some((action) => !requestedHostActions.has(action))) {
      context.addIssue({ code: "custom", message: "Base GUI host action grant 必须是 requested host action 的子集" });
    }
    const workspaceScopeGranted = decision.grantedCapabilityScopes.workspaceRead === "design/";
    if (workspaceScopeGranted && (
      decision.requestedCapabilityScopes.workspaceRead !== "design/" ||
      !decision.grantedCapabilities.includes("workspace-read")
    )) {
      context.addIssue({ code: "custom", message: "workspace-read scope 必须与已授予 capability 同时存在" });
    }
    const grantCount = decision.grantedCapabilities.length +
      decision.grantedHostActions.length +
      (workspaceScopeGranted ? 1 : 0);
    if (decision.state === "approved" && grantCount === 0) {
      context.addIssue({ code: "custom", message: "Base GUI approved decision 不能是空 grant" });
    }
    if (decision.state !== "approved" && grantCount > 0) {
      context.addIssue({ code: "custom", message: "Base GUI 未批准 decision 不能携带 grant" });
    }
  });

const tombstoneSchema = z
  .object({
    appId: z.string().regex(/^[a-z0-9]{10}$/),
    generationId: z.string().min(1),
    revision: z.number().int().positive(),
    revokedAt: z.number().int().nonnegative(),
  })
  .strict();

const fileSchema = z
  .object({
    schemaVersion: z.literal(2),
    revision: z.number().int().nonnegative(),
    decisions: z.array(decisionSchema),
    revokeTombstones: z.array(tombstoneSchema),
  })
  .strict();

type StoreFile = z.infer<typeof fileSchema>;

const empty = (): StoreFile => ({
  schemaVersion: 2,
  revision: 0,
  decisions: [],
  revokeTombstones: [],
});

export class BaseGuiGrantStore {
  readonly filePath: string;
  private state = empty();
  private serial = Promise.resolve();

  constructor(userData: string) {
    this.filePath = join(userData, "apps", "base-gui-grants.json");
  }

  async initialize() {
    try {
      const content = await readFile(this.filePath, "utf8");
      try {
        this.state = fileSchema.parse(JSON.parse(content));
      } catch (cause) {
        throw new DurableFileCorruptionError(this.filePath, cause);
      }
      return;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
        await this.persist();
        return;
      }
      if (!(cause instanceof DurableFileCorruptionError)) throw cause;
      /* 旧 schema/损坏不阻断启动：隔离原件后以空账本冷启动（照
         memory/delivery/maintenance-store 的既有隔离惯例）。后果如实——
         全部 generation 的 grant 归空，Base App 重装后重新逐项授权。 */
      console.warn(
        `[apps] Base GUI 授权账本无法读取，已隔离旧版数据（备份至 ${this.filePath}.quarantine-*），Base App 请重装`,
        cause
      );
    }
    await quarantineDurableFile(this.filePath);
    this.state = empty();
    await this.persist();
  }

  createDecision(input: {
    appId: string;
    generationId: string;
    contentDigest: `sha256:${string}`;
    expectedActiveGenerationId: string | null;
    requestedCapabilities: readonly BaseGuiCapability[];
    requestedHostActions: readonly BaseGuiHostActionCapability[];
    requestedCapabilityScopes: BaseGuiCapabilityScopes;
  }) {
    return this.mutate(() => {
      const existing = this.state.decisions.find(
        (item) =>
          item.appId === input.appId && item.generationId === input.generationId
      );
      if (existing) return existing;
      const source = input.expectedActiveGenerationId
        ? this.projection(input.appId, input.expectedActiveGenerationId)
        : null;
      const requestedCapabilities = uniqueCapabilities(input.requestedCapabilities);
      const requestedHostActions = uniqueHostActions(input.requestedHostActions);
      const requestedCapabilityScopes = normalizeScopes(
        input.requestedCapabilityScopes,
        requestedCapabilities
      );
      const hasRequest = requestedCapabilities.length > 0 || requestedHostActions.length > 0;
      const derived = hasRequest &&
        requestedCapabilities.every((capability) =>
          source?.capabilities.includes(capability)
        ) &&
        requestedHostActions.every((action) =>
          source?.hostActions.includes(action)
        ) &&
        requestedCapabilityScopes.workspaceRead ===
          source?.capabilityScopes.workspaceRead;
      const decision: BaseGuiCapabilityDecision = {
        decisionId: randomUUID(),
        revision: this.nextRevision(),
        ...input,
        requestedCapabilities,
        requestedHostActions,
        requestedCapabilityScopes,
        grantedCapabilities: derived ? requestedCapabilities : [],
        grantedHostActions: derived ? requestedHostActions : [],
        grantedCapabilityScopes: derived ? requestedCapabilityScopes : {},
        state: derived ? "approved" : "consent-required",
      };
      this.state.decisions.push(decision);
      return decision;
    });
  }

  decide(input: {
    appId: string;
    generationId: string;
    decisionId: string;
    expectedRevision: number;
    contentDigest: `sha256:${string}`;
    grantedCapabilities: readonly BaseGuiCapability[];
    grantedHostActions?: readonly BaseGuiHostActionCapability[];
    grantedCapabilityScopes?: BaseGuiCapabilityScopes;
  }) {
    return this.mutate(() => {
      const index = this.state.decisions.findIndex(
        (item) => item.decisionId === input.decisionId
      );
      const current = this.state.decisions[index];
      if (!current) throw new Error("Base GUI capability decision 不存在");
      if (current.state !== "consent-required") return current;
      if (
        current.appId !== input.appId ||
        current.generationId !== input.generationId ||
        current.revision !== input.expectedRevision ||
        current.contentDigest !== input.contentDigest
      ) {
        throw conflict("Base GUI capability decision fence 已变化");
      }
      const grantedCapabilities = uniqueCapabilities(input.grantedCapabilities).filter(
        (capability) => current.requestedCapabilities.includes(capability)
      );
      const grantedHostActions = uniqueHostActions(input.grantedHostActions ?? []).filter(
        (action) => current.requestedHostActions.includes(action)
      );
      const requestedScopeGrant = normalizeScopes(
        input.grantedCapabilityScopes ?? {},
        grantedCapabilities
      );
      const grantedCapabilityScopes =
        current.requestedCapabilityScopes.workspaceRead === "design/" &&
        requestedScopeGrant.workspaceRead === "design/"
          ? { workspaceRead: "design/" as const }
          : {};
      const approved = grantedCapabilities.length > 0 || grantedHostActions.length > 0;
      const decision: BaseGuiCapabilityDecision = {
        ...current,
        revision: this.nextRevision(),
        grantedCapabilities,
        grantedHostActions,
        grantedCapabilityScopes,
        state: approved ? "approved" : "declined",
      };
      this.state.decisions[index] = decision;
      return decision;
    });
  }

  revoke(appId: string, generationId: string, now = Date.now()) {
    return this.mutate(() => {
      const existing = this.state.revokeTombstones.find(
        (item) => item.appId === appId && item.generationId === generationId
      );
      if (existing) return existing;
      const tombstone = {
        appId,
        generationId,
        revision: this.nextRevision(),
        revokedAt: now,
      };
      this.state.revokeTombstones.push(tombstone);
      return tombstone;
    });
  }

  decision(decisionId: string) {
    const value = this.state.decisions.find(
      (item) => item.decisionId === decisionId
    );
    return value ? structuredClone(value) : null;
  }

  projection(appId: string, generationId: string) {
    const revoked = this.state.revokeTombstones.find(
      (item) => item.appId === appId && item.generationId === generationId
    );
    const decision = [...this.state.decisions]
      .reverse()
      .find(
        (item) => item.appId === appId && item.generationId === generationId
      );
    return {
      revision: revoked?.revision ?? decision?.revision ?? 0,
      decision: decision ? structuredClone(decision) : null,
      revokedAt: revoked?.revokedAt ?? null,
      capabilities:
        !revoked && decision?.state === "approved"
          ? [...decision.grantedCapabilities]
          : [],
      hostActions:
        !revoked && decision?.state === "approved"
          ? [...decision.grantedHostActions]
          : [],
      capabilityScopes:
        !revoked && decision?.state === "approved"
          ? structuredClone(decision.grantedCapabilityScopes)
          : {},
    };
  }

  promotable(input: {
    appId: string;
    generationId: string;
    contentDigest: `sha256:${string}`;
    decisionId: string;
    expectedRevision: number;
  }) {
    const projection = this.projection(input.appId, input.generationId);
    return Boolean(
      !projection.revokedAt &&
        projection.decision?.decisionId === input.decisionId &&
        projection.decision.revision === input.expectedRevision &&
        projection.decision.contentDigest === input.contentDigest &&
        projection.decision.state === "approved"
    );
  }

  private nextRevision() {
    this.state.revision += 1;
    return this.state.revision;
  }

  private async mutate<T>(operation: () => T) {
    const wait = this.serial;
    let release!: () => void;
    this.serial = new Promise<void>((resolve) => {
      release = resolve;
    });
    await wait;
    const previous = structuredClone(this.state);
    try {
      const value = structuredClone(operation());
      await this.persist();
      return value;
    } catch (cause) {
      this.state = previous;
      throw cause;
    } finally {
      release();
    }
  }

  private async persist() {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, this.filePath);
  }
}

function uniqueCapabilities(values: readonly BaseGuiCapability[]) {
  return [...new Set(values)];
}

function uniqueHostActions(values: readonly BaseGuiHostActionCapability[]) {
  return [...new Set(values)];
}

function normalizeScopes(
  scopes: BaseGuiCapabilityScopes,
  capabilities: readonly BaseGuiCapability[]
): BaseGuiCapabilityScopes {
  return scopes.workspaceRead === "design/" && capabilities.includes("workspace-read")
    ? { workspaceRead: "design/" }
    : {};
}

function conflict(message: string) {
  return Object.assign(new Error(message), { status: 409 });
}
