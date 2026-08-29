/**
 * [INPUT]: Depends on DurableJson, immutable package inspection/copy/digest primitives, an exact catalog trust tuple, and narrow App lifecycle/grant/custody ports
 * [OUTPUT]: Provides DesignFactoryProvisioner with offline eager installation, resumable final-grant commit, delete tombstone, user-explicit offline reinstall, drift state, and rollback-safe reset-to-pin
 * [POS]: Design factory delivery state machine; it alone may auto-approve the factory grant set and never treats preset identity without exact bytes as trust
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { DurableJson } from "../../persistence/durable-json";
import {
  copyPackage,
  inspectPackage,
  packageDigest,
  removePackageArtifact,
} from "../../apps/share/package-contract";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const trustSchema = z
  .object({
    presetId: z.literal("design-canvas"),
    repoUrl: z.string().url().regex(/^https:\/\/github\.com\//),
    catalogPin: z.string().regex(/^[a-f0-9]{40}$/),
    treeDigest: digestSchema,
  })
  .strict();
const phaseSchema = z.enum([
  "none",
  "installed",
  "gui-approved",
  "promoted",
  "custody-ready",
  "complete",
]);
const conditionSchema = z.enum([
  "provisioning",
  "factory",
  "drifted",
  "pin-drift",
  "failed",
  "resetting",
  "reset-failed",
  "deleted",
]);
const fileSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().nonnegative(),
    requestId: z.string().uuid(),
    custodySlotId: z.literal("factory:design-canvas:singleton"),
    trust: trustSchema.nullable(),
    appId: z.string().regex(/^[a-z0-9]{10}$/).nullable(),
    phase: phaseSchema,
    condition: conditionSchema,
    previousDigest: digestSchema.nullable(),
    error: z.string().max(3_500).nullable(),
    deletedAt: z.number().int().nonnegative().nullable(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();

type FactoryFile = z.infer<typeof fileSchema>;
export type DesignFactoryTrust = z.infer<typeof trustSchema>;
export type DesignFactoryApp = Readonly<{
  id: string;
  origin: "github" | "local" | "preset";
  presetId?: string;
  installedPresetPin?: string;
  ready: boolean;
  pending: boolean;
  defaultGrant: boolean;
  activeSourceDigest: string | null;
}>;

export type DesignFactoryPorts = Readonly<{
  find(appId: string | null): DesignFactoryApp | null;
  install(input: {
    requestId: string;
    packageRoot: string;
    packageDigest: string;
    trust: DesignFactoryTrust;
  }): Promise<DesignFactoryApp>;
  approveFactoryGui(appId: string): Promise<DesignFactoryApp>;
  promote(appId: string): Promise<DesignFactoryApp>;
  activateCustody(appId: string): Promise<void>;
  enableGlobal(appId: string): Promise<DesignFactoryApp>;
  resetToPayload(input: {
    appId: string;
    packageRoot: string;
    trust: DesignFactoryTrust;
  }): Promise<DesignFactoryApp>;
}>;

export class DesignFactoryProvisioner {
  private readonly root: string;
  private readonly file: DurableJson<FactoryFile>;
  private ports: DesignFactoryPorts | null = null;

  constructor(
    userData: string,
    private readonly now: () => number = Date.now,
    private readonly createId: () => string = randomUUID
  ) {
    this.root = join(userData, "design", "provisioning");
    this.file = new DurableJson(join(this.root, "factory.json"), fileSchema, () => ({
      schemaVersion: 1,
      revision: 0,
      requestId: createId(),
      custodySlotId: "factory:design-canvas:singleton",
      trust: null,
      appId: null,
      phase: "none",
      condition: "provisioning",
      previousDigest: null,
      error: null,
      deletedAt: null,
      updatedAt: this.now(),
    }));
  }

  initialize() {
    return this.file.initialize();
  }

  configure(ports: DesignFactoryPorts) {
    if (this.ports) throw new Error("Design factory ports 已配置");
    this.ports = ports;
  }

  snapshot() {
    return this.file.snapshot();
  }

  async ensure(sourceRoot: string, rawTrust: DesignFactoryTrust) {
    const trust = trustSchema.parse(rawTrust);
    const state = this.file.snapshot();
    if (
      state.condition === "deleted" ||
      (state.condition === "failed" && state.deletedAt !== null)
    ) return state;
    try {
      await assertSourceTrust(sourceRoot, trust);
      let app = this.requirePorts().find(state.appId);
      // 拒绝静默复活是全局前置，不止 complete/factory 分支：一旦账本记过 appId 却查无
      // App（冷启动隔离/外部移除），任何 condition（drifted/pin-drift/reset-failed/…）
      // 都不得落到 install() 重新自动授权——那是把一次授权事件伪装成首装。
      if (state.appId !== null && !app) {
        return this.record({ condition: "failed", error: "Design factory App 已缺失，拒绝静默复活" });
      }
      if (state.phase === "complete" && state.condition === "factory") {
        if (!isTrustedFactory(app!, trust)) {
          return this.record({
            condition: app!.installedPresetPin === trust.catalogPin
              ? "drifted"
              : "pin-drift",
            appId: app!.id,
            error: null,
          });
        }
        // defaultGrant=null is a durable user close, never an incomplete install.
        return state;
      }
      if (app && !isTrustedFactory(app, trust)) {
        const condition = app.installedPresetPin === trust.catalogPin
          ? "drifted"
          : "pin-drift";
        return this.record({ condition, appId: app.id, error: null });
      }
      if (!app) app = await this.install(sourceRoot, trust);
      if (app.pending) {
        app = await this.requirePorts().approveFactoryGui(app.id);
        await this.record({ phase: "gui-approved", appId: app.id, trust });
      }
      if (!app.ready) {
        app = await this.requirePorts().promote(app.id);
        await this.record({ phase: "promoted", appId: app.id, trust });
      }
      await this.requirePorts().activateCustody(app.id);
      await this.record({ phase: "custody-ready", appId: app.id, trust });
      if (!app.defaultGrant) app = await this.requirePorts().enableGlobal(app.id);
      if (!app.ready || !app.defaultGrant || !isTrustedFactory(app, trust)) {
        throw new Error("Design factory 最终 grant/cutover 证明不完整");
      }
      return this.record({
        phase: "complete",
        condition: "factory",
        appId: app.id,
        trust,
        previousDigest: null,
        deletedAt: null,
        error: null,
      });
    } catch (cause) {
      await this.record({
        condition: "failed",
        error: errorMessage(cause),
      });
      throw cause;
    }
  }

  async reinstall(sourceRoot: string, rawTrust: DesignFactoryTrust) {
    const trust = trustSchema.parse(rawTrust);
    const state = this.file.snapshot();
    const retryingExplicitReinstall =
      state.condition === "failed" && state.deletedAt !== null;
    if (state.condition !== "deleted" && !retryingExplicitReinstall) {
      throw new Error("Design factory 仅能在用户显式删除后重装");
    }
    await this.file.mutate((current) => {
      current.revision += 1;
      current.requestId = this.createId();
      current.trust = trust;
      current.appId = null;
      current.phase = "none";
      current.condition = "provisioning";
      current.previousDigest = null;
      current.error = null;
      current.updatedAt = this.now();
      return current;
    });
    return this.ensure(sourceRoot, trust);
  }

  async resetToPin(sourceRoot: string, rawTrust: DesignFactoryTrust) {
    const trust = trustSchema.parse(rawTrust);
    const current = this.file.snapshot();
    if (current.condition === "deleted") throw new Error("Design factory 已被用户删除");
    const app = this.requirePorts().find(current.appId);
    if (!app?.ready || !app.defaultGrant) throw new Error("Design factory 不可重置");
    await assertSourceTrust(sourceRoot, trust);
    await this.record({
      condition: "resetting",
      previousDigest: digestSchema.nullable().parse(app.activeSourceDigest),
      error: null,
    });
    const staging = await this.copyToStaging(sourceRoot, `${current.requestId}-reset`);
    try {
      const reset = await this.requirePorts().resetToPayload({
        appId: app.id,
        packageRoot: staging,
        trust,
      });
      if (!reset.ready || !reset.defaultGrant || !isTrustedFactory(reset, trust)) {
        throw new Error("Design factory reset 未落到目标 pin");
      }
      return await this.record({
        condition: "factory",
        phase: "complete",
        trust,
        previousDigest: null,
        error: null,
      });
    } catch (cause) {
      await this.record({ condition: "reset-failed", error: errorMessage(cause) });
      throw cause;
    } finally {
      await removePackageArtifact(join(staging, "..")).catch(() => undefined);
    }
  }

  markDeleted(appId: string) {
    const current = this.file.snapshot();
    if (current.appId && current.appId !== appId) return Promise.resolve(current);
    return this.record({
      appId,
      condition: "deleted",
      phase: "none",
      deletedAt: this.now(),
      error: null,
    });
  }

  closeAndFlush() {
    return this.file.closeAndFlush();
  }

  private async install(sourceRoot: string, trust: DesignFactoryTrust) {
    const current = this.file.snapshot();
    const packageRoot = await this.copyToStaging(sourceRoot, current.requestId);
    try {
      const app = await this.requirePorts().install({
        requestId: current.requestId,
        packageRoot,
        packageDigest: trust.treeDigest.slice("sha256:".length),
        trust,
      });
      await this.record({ phase: "installed", appId: app.id, trust, error: null });
      return app;
    } catch (cause) {
      await removePackageArtifact(join(packageRoot, "..")).catch(() => undefined);
      throw cause;
    }
  }

  private async copyToStaging(sourceRoot: string, name: string) {
    const parent = join(this.root, "staging", name);
    const packageRoot = join(parent, "package");
    await rm(parent, { recursive: true, force: true });
    await copyPackage(sourceRoot, packageRoot);
    return packageRoot;
  }

  private record(patch: Partial<Omit<FactoryFile, "schemaVersion" | "revision" | "requestId" | "custodySlotId" | "updatedAt">>) {
    return this.file.mutate((state) => {
      Object.assign(state, patch);
      state.revision += 1;
      state.updatedAt = this.now();
      return state;
    });
  }

  private requirePorts() {
    if (!this.ports) throw new Error("Design factory ports 尚未配置");
    return this.ports;
  }
}

async function assertSourceTrust(sourceRoot: string, trust: DesignFactoryTrust) {
  const inspection = await inspectPackage(sourceRoot);
  if (inspection.ignored.length) throw new Error("Design factory payload 含未签名文件");
  const actual = `sha256:${await packageDigest(sourceRoot, inspection.files)}`;
  if (actual !== trust.treeDigest) throw new Error("Design factory treeDigest 不匹配");
}

function isTrustedFactory(app: DesignFactoryApp, trust: DesignFactoryTrust) {
  return app.origin === "preset" &&
    app.presetId === trust.presetId &&
    app.installedPresetPin === trust.catalogPin &&
    app.activeSourceDigest === trust.treeDigest;
}

const errorMessage = (cause: unknown) =>
  (cause instanceof Error ? cause.message : String(cause)).slice(0, 3_500);
