/**
 * [INPUT]: Depends on App generation plans, durable participant ledgers, Extension/Base GUI participants, server cutover, and sealed artifact storage
 * [OUTPUT]: Provides generation build staging, compatibility-bound Base GUI decisions, Studio-pending GUI generations, participant checkpoints, rollback, artifact cleanup, and post-commit settlement
 * [POS]: App generation saga owner beneath AppStore; AppStore retains record serialization and public lifecycle commands
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { rename } from "node:fs/promises";
import type { AppGeneration, AppRecord, BaseGuiCapabilityDecision } from "../../../shared/apps-ipc";
import type { AppGenerationBuildOperation } from "../../../shared/app-lifecycle";
import type { AppGenerationBuildLedger } from "./app-generation-build-ledger";
import type { AppServerCutoverPort, PreparedServerCutover } from "./app-server-cutover";
import type { AppExtensionGenerationPort } from "./app-extension-generation";
import type { AppGenerationBuildParticipantRegistry } from "../lifecycle/app-generation-build-participants";
import type { BaseGuiGrantStore } from "./base-gui/grant-store";
import type { BaseGuiBuildParticipant } from "./base-gui/build-participant";
import type { AppGuiBuildService } from "./gui-build/service";
import { removePackageArtifact, sealPackageArtifact } from "./share/package-contract";
import {
  allParticipantsPromotable,
  bindActive,
  bindCapabilityPending,
  bindPending,
  conflict,
  decisionPointer,
  needsServerEpoch,
  planGeneration,
  runtimeBinding,
  sealGeneration,
  type GenerationPlanOptions,
  type NewGenerationPlan,
} from "./app-generation-plan";

export type AppGenerationBuilderHost = Readonly<{
  artifactsRoot: string;
  get(appId: string): AppRecord | undefined;
  artifactRoot(appId: string, generationId: string): string;
  commitRecord(record: AppRecord, appId: string, previous?: AppRecord): Promise<AppRecord>;
  buildLedger(): AppGenerationBuildLedger | null;
  serverCutover(): AppServerCutoverPort | null;
  participants(): AppGenerationBuildParticipantRegistry | null;
  extensions(): AppExtensionGenerationPort | null;
  baseGuiGrants(): BaseGuiGrantStore | null;
  baseGuiParticipant(): BaseGuiBuildParticipant | null;
  appGuiCompiler(): AppGuiBuildService | null;
}>;

export class AppGenerationBuilder {
  constructor(private readonly host: AppGenerationBuilderHost) {}
  private get artifactsRoot() { return this.host.artifactsRoot; }
  private get buildLedger() { return this.host.buildLedger(); }
  private get serverCutover() { return this.host.serverCutover(); }
  private get participants() { return this.host.participants(); }
  private get extensions() { return this.host.extensions(); }
  private get baseGuiGrants() { return this.host.baseGuiGrants(); }
  private get baseGuiParticipant() { return this.host.baseGuiParticipant(); }
  private get appGuiCompiler() { return this.host.appGuiCompiler(); }
  private get(appId: string) { return this.host.get(appId); }
  private artifactRoot(appId: string, generationId: string) { return this.host.artifactRoot(appId, generationId); }
  private commitRecord(record: AppRecord, appId: string, previous?: AppRecord) {
    return this.host.commitRecord(record, appId, previous);
  }

  async set(
    record: AppRecord,
    prepared: PreparedServerCutover | null = null,
    options: GenerationPlanOptions = {}
  ) {
    const previous = this.host.get(record.id);
    const compiledManifest = record.manifest?.kind === "base" && record.manifest.gui?.build
      ? record.manifest
      : null;
    const compiled = options.compiled ?? (compiledManifest
      ? await this.requireAppGuiCompiler().prepare({
          appId: record.id,
          sourceRoot: options.sourceDir ?? record.dir,
          manifest: compiledManifest,
        })
      : null);
    let operation: AppGenerationBuildOperation | null = null;
    let plan: NewGenerationPlan | null = null;
    let committed = false;
    try {
      plan = await planGeneration(record, previous, { ...options, ...(compiled ? { compiled } : {}) });
      if (!plan) return this.commitRecord(record, record.id, previous);
      if (compiled) {
        await compiled.seal(this.artifactRoot(record.id, plan.generationId));
      } else {
        await sealPackageArtifact({
          source: plan.sourceDir,
          finalRoot: this.artifactRoot(record.id, plan.generationId),
          manifest: plan.manifest,
          expected: plan.digests,
        });
      }
      operation = await this.beginBuild(plan);
      /* 有声明就必须先拿到 participant 的 prepared handoff：pending 代只引用
         committed reservation 与 decision，永不直接 CAS active。 */
      const staged = plan.declarations.length
        ? await this.stageExtension(plan, operation)
        : this.stageWithoutExtensions(plan);
      if (staged.operation) operation = staged.operation;
      const capabilityBound = await this.bindBaseGuiCapability(
        plan,
        staged.record,
        operation
      );
      operation = capabilityBound.operation;
      const bound = this.bindPreparedEpoch(capabilityBound.record, plan, prepared);
      await this.commitRecord(bound, record.id, previous);
      committed = true;
      await this.settleBuild(plan, operation);
      return this.get(record.id)!;
    } catch (cause) {
      if (!committed && plan) {
        try {
          await this.rollbackBuild(plan, operation);
        } catch (rollbackCause) {
          throw new AggregateError(
            [cause, rollbackCause],
            "generation build 失败且 participant abort 未完全收口"
          );
        }
      }
      throw cause;
    } finally {
      await compiled?.cleanup();
    }
  }

  private requireAppGuiCompiler() {
    if (!this.appGuiCompiler) {
      throw Object.assign(new Error("compiled App GUI compiler is unavailable"), {
        code: "GUI_COMPILER_SANDBOX_UNAVAILABLE",
      });
    }
    return this.appGuiCompiler;
  }

  /**
   * 有 GUI 的 Base generation 即使没声明可写 capability，也必须先停在 pending：
   * read-only Studio grant 仍需显式落盘，不能被 bindActive 偷跑越过授权点。
   */
  private stageWithoutExtensions(plan: NewGenerationPlan) {
    const generation = sealGeneration(plan, { kind: "none" });
    if (plan.manifest.kind !== "base" || !plan.manifest.gui) {
      return { record: bindActive(plan, generation), operation: null };
    }
    return {
      record: bindCapabilityPending(plan, generation, plan.base, {
        generationId: generation.generationId,
        expectedActiveGenerationId: plan.previousActiveId,
        resolutionDigest: generation.contentDigest,
        packageGenerationReservationId: `studio:${generation.generationId}`,
        runtime: runtimeBinding(plan),
        consentDecisionId: `studio:${generation.generationId}`,
        expectedConsentRevision: 0,
        state: "ready-to-promote",
      }),
      operation: null,
    };
  }

  private async bindBaseGuiCapability(
    plan: NewGenerationPlan,
    record: AppRecord,
    operation: AppGenerationBuildOperation | null
  ) {
    if (plan.manifest.kind !== "base") return { record, operation };
    if (
      plan.requestedBaseGuiCapabilities.length === 0 &&
      plan.requestedBaseGuiHostActions.length === 0
    ) {
      return { record, operation };
    }
    if (!this.baseGuiGrants) {
      throw new Error("Base GUI capability generation 需要已初始化的 grant store");
    }
    const generation = record.generations.find(
      (item) => item.generationId === plan.generationId
    );
    if (!generation) throw new Error("Base GUI capability generation 尚未 sealed");
    let decision: BaseGuiCapabilityDecision;
    if (operation && this.baseGuiParticipant && this.buildLedger) {
      const prepared = await this.baseGuiParticipant.prepare(operation);
      const checkpointed = await this.buildLedger.checkpoint(
        operation.generationBuildId,
        operation.revision,
        prepared
      );
      operation = checkpointed;
      const durable = this.baseGuiGrants.decision(prepared.operationId);
      if (prepared.state !== "prepared" || !durable) {
        await this.buildLedger.advance(
          checkpointed.generationBuildId,
          checkpointed.revision,
          "needs-attention"
        );
        throw new Error("Base GUI capability participant 未就绪");
      }
      decision = durable;
    } else {
      decision = await this.baseGuiGrants.createDecision({
        appId: plan.base.id,
        generationId: generation.generationId,
        contentDigest: generation.contentDigest,
        expectedActiveGenerationId: plan.previousActiveId,
        requestedCapabilities: plan.requestedBaseGuiCapabilities,
        requestedHostActions: plan.requestedBaseGuiHostActions,
        requestedCapabilityScopes: plan.requestedBaseGuiCapabilityScopes,
      });
    }
    if (!generation.compatibilityRefDigest) {
      throw new Error("Base GUI generation compatibility ref 尚未 sealed");
    }
    decision = await this.baseGuiGrants.bindCompatibility({
      appId: plan.base.id,
      generationId: generation.generationId,
      compatibilityRefDigest: generation.compatibilityRefDigest,
    }) ?? decision;
    if (!record.generationBinding.pending && decision.state === "approved") {
      return { record, operation };
    }
    const pending = record.generationBinding.pending ?? {
      generationId: generation.generationId,
      expectedActiveGenerationId: plan.previousActiveId,
      resolutionDigest: generation.contentDigest,
      packageGenerationReservationId: `base-gui:${generation.generationId}`,
      runtime: runtimeBinding(plan),
      consentDecisionId: decision.decisionId,
      expectedConsentRevision: decision.revision,
      state: "consent-required" as const,
    };
    const nextPending = {
      ...pending,
      baseGuiDecision: decisionPointer(decision),
      ...(record.generationBinding.pending
        ? { extensionState: record.generationBinding.pending.state }
        : {}),
    };
    nextPending.state = allParticipantsPromotable(nextPending)
      ? "ready-to-promote"
      : "consent-required";
    return {
      record: bindCapabilityPending(plan, generation, record, nextPending),
      operation,
    };
  }

  /**
   * 队列内重验：队列外预判过的那一代必须逐字段仍然成立，才允许把 target
   * epoch 整体 CAS 进 active binding。世界在等待期间变了就当场失败——
   * 让 cutover 走 abort，而不是把新代 binary 绑到一个别人的 epoch 上。
   */
  private bindPreparedEpoch(
    record: AppRecord,
    plan: NewGenerationPlan,
    prepared: PreparedServerCutover | null
  ): AppRecord {
    if (!needsServerEpoch(plan) || !this.serverCutover) return record;
    if (!prepared || prepared.generationId !== plan.generationId) {
      throw conflict("server data cutover 与本次 generation 不匹配");
    }
    return {
      ...record,
      generationBinding: {
        ...record.generationBinding,
        active: {
          generationId: plan.generationId,
          runtime: { kind: "server", dataEpochId: prepared.dataEpochId },
        },
      },
    };
  }

  private async beginBuild(plan: NewGenerationPlan) {
    if (!this.buildLedger) return null;
    return this.buildLedger.begin({
      generationBuildId: plan.generationBuildId,
      appId: plan.base.id,
      appGenerationId: plan.generationId,
      expectedActiveGenerationId: plan.previousActiveId,
      domainIdentity: plan.domainIdentity,
      runtime: runtimeBinding(plan),
      extensionRequirements: plan.declarations,
      ...(plan.manifest.kind === "base" &&
        this.baseGuiParticipant &&
        (plan.requestedBaseGuiCapabilities.length > 0 ||
          plan.requestedBaseGuiHostActions.length > 0)
        ? {
            baseGuiCapabilityRequest: {
              requestedCapabilities: plan.requestedBaseGuiCapabilities,
              requestedHostActions: plan.requestedBaseGuiHostActions,
              requestedCapabilityScopes: plan.requestedBaseGuiCapabilityScopes,
              contentDigest: plan.contentDigest,
            },
          }
        : {}),
    });
  }

  private async stageExtension(
    plan: NewGenerationPlan,
    operation: AppGenerationBuildOperation | null
  ) {
    const participant = this.participants?.require("app-extension");
    const extensions = this.extensions;
    if (!participant || !extensions || !operation || !this.buildLedger) {
      throw new Error(
        "含 extensionRequirements 的 generation 需要已注册的 App×Extension participant"
      );
    }
    const prepared = await participant.prepare(operation);
    let next = await this.buildLedger.checkpoint(
      operation.generationBuildId,
      operation.revision,
      prepared
    );
    const handoff =
      prepared.state === "prepared"
        ? extensions.handoff(operation.generationBuildId)
        : null;
    if (!handoff) {
      next = await this.buildLedger.advance(
        operation.generationBuildId,
        next.revision,
        "needs-attention"
      );
      throw new Error("App extension reservation 未就绪，build 保持 needs-attention");
    }
    const consent = await extensions.decide({
      appId: plan.base.id,
      frozenSet: handoff.frozenSet,
      deriveFromGenerationId: plan.previousActiveId,
    });
    const generation = sealGeneration(plan, {
      kind: "frozen",
      frozenSet: handoff.frozenSet,
      packageGenerationReservationId: handoff.reservationId,
    });
    return {
      record: bindPending(plan, generation, handoff, consent),
      operation: next,
    };
  }

  private async rollbackBuild(
    plan: NewGenerationPlan,
    operation: AppGenerationBuildOperation | null
  ) {
    if (operation) {
      await this.abortOperation(operation);
    } else if (plan.manifest.kind === "base" && this.baseGuiGrants) {
      await this.baseGuiGrants.revoke(plan.base.id, plan.generationId);
    }
    await this.discardArtifact(plan.base.id, plan.generationId);
  }

  async abortGenerationBuild(
    appId: string,
    generation: AppGeneration
  ) {
    const operation = this.buildLedger
      ?.listNonTerminal(appId)
      .find(
        (item) => item.generationBuildId === generation.generationBuildId
      );
    if (!operation) {
      await this.baseGuiGrants?.revoke(appId, generation.generationId);
      return;
    }
    await this.abortOperation(operation);
  }

  /** 所有 participant 的 aborted checkpoint 都 durable 后，build 才能进入终态。 */
  private async abortOperation(operation: AppGenerationBuildOperation) {
    if (!this.buildLedger) throw new Error("generation build ledger 未配置");
    let next = operation;
    try {
      if (next.extensionRequirements.length > 0) {
        const aborted = await this.participants!
          .require("app-extension")
          .abort(next);
        next = await this.buildLedger.checkpoint(
          next.generationBuildId,
          next.revision,
          aborted
        );
      }
      if (next.baseGuiCapabilityRequest) {
        if (!this.baseGuiParticipant) {
          throw new Error("Base GUI participant 未配置");
        }
        const aborted = await this.baseGuiParticipant.abort(next);
        next = await this.buildLedger.checkpoint(
          next.generationBuildId,
          next.revision,
          aborted
        );
      }
      await this.buildLedger.advance(
        next.generationBuildId,
        next.revision,
        "aborted"
      );
    } catch (cause) {
      await this.buildLedger
        .advance(next.generationBuildId, next.revision, "needs-attention")
        .catch(() => {});
      throw cause;
    }
  }

  async discardArtifact(appId: string, generationId: string) {
    const root = this.artifactRoot(appId, generationId);
    const trash = join(this.artifactsRoot, appId, `.trash-${randomUUID()}`);
    const moved = await rename(root, trash).then(
      () => true,
      (cause: NodeJS.ErrnoException) => {
        if (cause.code === "ENOENT") return false;
        throw cause;
      }
    );
    if (moved) await removePackageArtifact(trash);
  }

  /* 无待授权的新代 build 一路走到 promoted；Extension/Base GUI 任一仍 pending，
     就停在 ready-to-promote，等独立 promote 命令复核全部 decision 后才切 active。 */
  private async settleBuild(
    plan: NewGenerationPlan,
    operation: AppGenerationBuildOperation | null
  ) {
    if (operation && this.buildLedger) {
      let next = await this.buildLedger.advance(
        operation.generationBuildId,
        operation.revision,
        "generation-committed"
      );
      const pending = this.get(plan.base.id)?.generationBinding.pending;
      if (plan.declarations.length) {
        const committed = await this.participants!.require(
          "app-extension"
        ).finalize(next);
        next = await this.buildLedger.checkpoint(
          next.generationBuildId,
          next.revision,
          committed
        );
        if (committed.state !== "committed") {
          await this.buildLedger.advance(
            next.generationBuildId,
            next.revision,
            "needs-attention"
          );
          throw new Error("App extension reservation commit 未通过逐字节复核");
        }
      }
      if (next.baseGuiCapabilityRequest) {
        const committed = await this.baseGuiParticipant!.finalize(next);
        next = await this.buildLedger.checkpoint(
          next.generationBuildId,
          next.revision,
          committed
        );
        if (committed.state !== "committed") {
          await this.buildLedger.advance(
            next.generationBuildId,
            next.revision,
            "needs-attention"
          );
          throw new Error("Base GUI capability decision commit 未通过 exact 复核");
        }
      }
      next = await this.buildLedger.advance(
        next.generationBuildId,
        next.revision,
        "ready-to-promote"
      );
      if (!pending) {
        await this.buildLedger.advance(
          next.generationBuildId,
          next.revision,
          "promoted"
        );
      }
    }
  }

}
