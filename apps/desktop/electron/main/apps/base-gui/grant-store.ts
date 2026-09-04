/**
 * [INPUT]: Depends on Node fs/path/crypto, zod and shared Base GUI generation/access identity
 * [OUTPUT]: Provides BaseGuiGrantStore plus BASE_GUI_PARTIAL_DECISION: stable compatibility-bound decision, all-or-nothing decide (exact request coverage or decline), idempotent compatibility-ref binding, self-administered approved state, append-only revoke tombstone, durable revision CAS on fsynced atomic replacement, and freezing air after damage/disruption
 * [POS]: authorized copywriter of apps/base-gui; The manifest only requests, and the active GUI writes only from the exact approved decision of the ledger
 */

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type {
  BaseGuiCapability,
  BaseGuiCapabilityDecision,
  BaseGuiCapabilityScopes,
  BaseGuiHostActionCapability,
} from "../../../../shared/apps-ipc";
import {
  DurableFileCorruptionError,
  durableReplaceFile,
  quarantineDurableFile,
} from "../../persistence/durable-json";

const digestSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/)
  .transform((value) => value as `sha256:${string}`);

/* `.strict()` 是断代的执行者：旧账本里那条已删除的迁移 revision 字段现在会被判为
   多余字段，整份文件在 initialize() 里按损坏隔离后空态冷启动——预发布期没有真实
   用户，重新授权一次比养一条永久的兼容读路径便宜得多。 */
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
    requestedHostActions: z.array(z.enum(["compose-text", "file.export"])).max(2).default([]),
    grantedHostActions: z.array(z.enum(["compose-text", "file.export"])).max(2).default([]),
    requestedCapabilityScopes: z
      .object({ workspaceRead: z.literal("design/").optional() })
      .strict()
      .default({}),
    grantedCapabilityScopes: z
      .object({ workspaceRead: z.literal("design/").optional() })
      .strict()
      .default({}),
    compatibilityRefDigest: digestSchema.optional(),
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
    compatibilityRefDigest?: `sha256:${string}`;
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
      const approved = coversRequest(current, {
        grantedCapabilities,
        grantedHostActions,
        grantedCapabilityScopes,
      });
      /* 空 grant 是拒绝，全量 grant 是批准，两者之外没有第三种可落地的答案：
         studio-grant 的放行判据要求逐项覆盖 requested 全集，子集写进账本也
         永远换不来 promotion，只会留下一条谁也修不了的「批准过但不算数」。
         与其让它安静地存在，不如在唯一写入点当场拒收。 */
      if (
        !approved &&
        (grantedCapabilities.length > 0 ||
          grantedHostActions.length > 0 ||
          grantedCapabilityScopes.workspaceRead === "design/")
      ) {
        throw partialDecision();
      }
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

  bindCompatibility(input: {
    appId: string;
    generationId: string;
    compatibilityRefDigest: `sha256:${string}`;
  }) {
    return this.mutate(() => {
      const indices = this.state.decisions.flatMap((decision, index) =>
        decision.appId === input.appId &&
        decision.generationId === input.generationId
          ? [index]
          : []
      );
      for (const index of indices) {
        const decision = this.state.decisions[index]!;
        if (decision.compatibilityRefDigest === input.compatibilityRefDigest) continue;
        if (
          decision.compatibilityRefDigest &&
          decision.compatibilityRefDigest !== input.compatibilityRefDigest
        ) {
          throw conflict("Base GUI compatibility ref digest 已变化");
        }
        this.state.decisions[index] = {
          ...decision,
          compatibilityRefDigest: input.compatibilityRefDigest,
          revision: this.nextRevision(),
        };
      }
      const latest = indices.at(-1);
      return latest === undefined ? null : this.state.decisions[latest]!;
    });
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

  /* 授权账本的落盘不能只靠 rename：不 fsync 就只是「文件名换了」，掉电后可能
     两份都不完整；固定的 .tmp 名字还会让并发写互相踩。durableReplaceFile 是
     全仓统一的原子替换，同一条路径也就只剩一种失败模式。 */
  private async persist() {
    await durableReplaceFile(
      this.filePath,
      `${JSON.stringify(this.state, null, 2)}\n`
    );
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

/* ── 全有或全无 ────────────────────────────────────────────────────
 * requested 三组（capability / host action / workspace scope）必须被
 * granted 三组逐项覆盖，才算 approved。少一项就不是「少批一点」，而是
 * 一份永远无法 promote 的死决定——见 ../store/studio-grant.ts。
 * ────────────────────────────────────────────────────────────── */
function coversRequest(
  requested: Pick<
    BaseGuiCapabilityDecision,
    "requestedCapabilities" | "requestedHostActions" | "requestedCapabilityScopes"
  >,
  granted: Pick<
    BaseGuiCapabilityDecision,
    "grantedCapabilities" | "grantedHostActions" | "grantedCapabilityScopes"
  >
) {
  return (
    requested.requestedCapabilities.length === granted.grantedCapabilities.length &&
    requested.requestedCapabilities.every((capability) =>
      granted.grantedCapabilities.includes(capability)
    ) &&
    requested.requestedHostActions.length === granted.grantedHostActions.length &&
    requested.requestedHostActions.every((action) =>
      granted.grantedHostActions.includes(action)
    ) &&
    requested.requestedCapabilityScopes.workspaceRead ===
      granted.grantedCapabilityScopes.workspaceRead &&
    (requested.requestedCapabilities.length > 0 ||
      requested.requestedHostActions.length > 0 ||
      requested.requestedCapabilityScopes.workspaceRead === "design/")
  );
}

export const BASE_GUI_PARTIAL_DECISION = "BASE_GUI_PARTIAL_DECISION";

function partialDecision() {
  return Object.assign(
    new Error(
      `${BASE_GUI_PARTIAL_DECISION}: Base GUI 授权只能整份批准或整份拒绝`
    ),
    { status: 409, code: BASE_GUI_PARTIAL_DECISION }
  );
}
