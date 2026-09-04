/**
 * [INPUT]: Depends on AppStore/BaseAppImporter/AppGrantAuthority, factory package paths, and custody activation/orphan callbacks
 * [OUTPUT]: Provides createDesignFactoryPorts, the concrete App lifecycle adapter for factory install, explicit Studio grants, a global grant taken from the shared defaultAppGrantRequest so opening availability never smuggles in an Agent delegation, promotion, legacy missing-owner cleanup, and pending-build-aborted source reset
 * [POS]: Design provisioning's Apps-domain edge; every state change is routed through an AppStore mutator, so AppStore.watch broadcasts it and this adapter carries no publisher of its own
 */

import { chmod, lstat, readFile, readdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentBackendId } from "../../../../shared/agent-ipc";
import { defaultAppGrantRequest } from "../../../../shared/apps-ipc";
import type { AppRecord } from "../../../../shared/apps-ipc";
import type { AppStore } from "../../apps/store/app-store";
import type { AppGrantAuthority } from "../../apps/attachments/grant-authority";
import type { BaseGuiGrantStore } from "../../apps/base-gui/grant-store";
import type { BaseAppImporter } from "../../apps/install/import-base-app";
import { appManifestSchema } from "../../apps/install/manifest-schema";
import { EMPTY_APP_CONFIG } from "../../apps/share/app-config-store";
import type {
  DesignFactoryApp,
  DesignFactoryPorts,
} from "./factory-provisioner";

export function createDesignFactoryPorts(input: {
  store: AppStore;
  importer: BaseAppImporter;
  grants: AppGrantAuthority;
  guiGrants: BaseGuiGrantStore;
  resolveAgent(): Promise<AgentBackendId>;
  activateCustody(appId: string): Promise<void>;
  orphanCustody(appId: string): Promise<void>;
}): DesignFactoryPorts {
  const find = (appId: string | null) => {
    const record = appId
      ? input.store.get(appId)
      : input.store.list().find((candidate) => candidate.presetId === "design-canvas");
    return record ? project(record) : null;
  };
  /* 工厂绕过 IPC 直呼 store/grant——这曾是「少写一条 emit 就让 renderer 停在
     成代前那一帧」的原点。现在广播由 AppStore 写入本身产生，这里只负责把已提交
     的记录投影成 saga 的语言。 */
  return {
    find,
    install: async ({ requestId, packageRoot, packageDigest, trust }) =>
      project(await input.importer.import({
        requestId,
        source: {
          origin: "preset",
          ref: trust.repoUrl,
          digest: packageDigest,
          packageRoot,
          preset: {
            presetId: trust.presetId,
            resolvedPin: trust.catalogPin,
            channel: "release",
          },
        },
        agent: await input.resolveAgent(),
        config: structuredClone(EMPTY_APP_CONFIG),
        authorization: {
          scope: "studio-only",
          decision: "approve-requested",
        },
      })),
    approveFactoryGui: async (appId) =>
      project(await input.store.resolvePendingBaseGuiConsent(
        appId,
        ["workspace-read"],
        ["compose-text"],
        { workspaceRead: "design/" }
      )),
    promote: async (appId) => {
      const pending = input.store.get(appId)?.generationBinding.pending;
      if (!pending) throw new Error("Design factory 缺少待 promote generation");
      return project(await input.store.promotePendingGeneration(
        appId,
        pending.expectedConsentRevision
      ));
    },
    activateCustody: input.activateCustody,
    orphanCustody: input.orphanCustody,
    /* 初装的「开放给全部」与画布上那条「重新打开」是同一个动作的两个时刻，
       写的也是同一个 defaultGrant——故取同一份载荷，不再各拼各的。Design 读
       工作区文件走的是上面 approveFactoryGui 那条 workspace-read 租约（scope
       锁在 design/），与 Agent 的 fileRead 委托是两套机制：把委托默认打开，
       只会让授权页的开关一装完就是开的，而用户从没被问过。 */
    enableGlobal: async (appId) =>
      project(await input.grants.setDefaultGrant({
        appId,
        grant: defaultAppGrantRequest("none"),
      })),
    resetToPayload: async ({ appId, packageRoot, trust }) => {
      const record = input.store.get(appId);
      if (!record?.generationBinding.active || !record.defaultGrant) {
        throw new Error("Design factory reset 前置状态无效");
      }
      const activeGenerationId = record.generationBinding.active.generationId;
      const gui = input.guiGrants.projection(appId, activeGenerationId);
      if (
        gui.revokedAt ||
        !gui.capabilities.includes("workspace-read") ||
        !gui.hostActions.includes("compose-text") ||
        gui.capabilityScopes.workspaceRead !== "design/"
      ) {
        throw new Error("Design factory reset 需要现有完整 GUI grant，拒绝重新自动批准");
      }
      const manifest = appManifestSchema.parse(
        JSON.parse(await readFile(join(packageRoot, "app.json"), "utf8"))
      );
      const backup = join(
        dirname(record.dir),
        `.${appId}.factory-backup-${Date.now()}`
      );
      await rename(record.dir, backup);
      try {
        await rename(packageRoot, record.dir);
        await makeWritable(record.dir);
        let saved = await input.store.publishGeneration(appId, (current) => ({
          ...current,
          manifest,
          presetId: trust.presetId,
          installedPresetPin: trust.catalogPin,
          state: "ready",
          lastError: null,
        }), { generationSourceDir: record.dir });
        const pending = saved.generationBinding.pending;
        if (pending) {
          saved = await input.store.grantStudioAccess(
            appId,
            pending.generationId
          );
          saved = await input.store.promotePendingGeneration(
            appId,
            saved.generationBinding.pending!.expectedConsentRevision
          );
        }
        const verified = project(saved);
        if (
          verified.pending ||
          !verified.ready ||
          verified.activeSourceDigest !== trust.treeDigest ||
          verified.installedPresetPin !== trust.catalogPin
        ) {
          throw new Error("Design factory reset generation 复核失败");
        }
        await rm(backup, { recursive: true, force: true });
        return project(saved);
      } catch (cause) {
        const committed = input.store.get(appId);
        const committedProjection = committed ? project(committed) : null;
        if (
          committedProjection?.activeSourceDigest === trust.treeDigest &&
          committedProjection.installedPresetPin === trust.catalogPin &&
          !committedProjection.pending
        ) {
          await rm(backup, { recursive: true, force: true }).catch(() => undefined);
          return committedProjection;
        }
        const pendingGenerationId = committed?.generationBinding.pending?.generationId;
        let rollbackCause: unknown = null;
        if (pendingGenerationId) {
          try {
            await input.store.abortPendingGeneration(appId, pendingGenerationId);
          } catch (abortCause) {
            rollbackCause = abortCause;
          }
        }
        await rm(record.dir, { recursive: true, force: true }).catch(() => undefined);
        await rename(backup, record.dir).catch(() => undefined);
        if (rollbackCause) {
          throw new AggregateError(
            [cause, rollbackCause],
            "Design factory reset 失败且 pending rollback 未收口"
          );
        }
        throw cause;
      }
    },
  };
}

function project(record: AppRecord): DesignFactoryApp {
  const activeId = record.generationBinding.active?.generationId;
  const active = record.generations.find(
    (generation) => generation.generationId === activeId
  );
  return {
    id: record.id,
    origin: record.origin,
    ...(record.presetId ? { presetId: record.presetId } : {}),
    ...(record.installedPresetPin
      ? { installedPresetPin: record.installedPresetPin }
      : {}),
    ready: record.state === "ready" && Boolean(active),
    pending: Boolean(record.generationBinding.pending),
    defaultGrant: record.defaultGrant != null,
    activeSourceDigest: active?.sourcePackageDigest ?? null,
  };
}

async function makeWritable(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink()) throw new Error("Design factory reset 拒绝 symlink");
  if (metadata.isDirectory()) {
    await chmod(path, 0o700);
    for (const entry of await readdir(path)) await makeWritable(join(path, entry));
    return;
  }
  if (!metadata.isFile()) throw new Error("Design factory reset 仅允许普通文件");
  await chmod(path, 0o600);
}
