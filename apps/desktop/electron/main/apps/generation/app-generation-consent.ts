/**
 * [INPUT]: Depends on App records, generation builder/ledger, Extension and Base GUI consent authorities, server cutover, and injected serialized commit ports
 * [OUTPUT]: Provides AppGenerationConsentController for pending consent, abort, and promotion transactions
 * [POS]: The AppStore generation-consent subdomain; AppStore remains the single writer while this controller owns the multi-authority state machine
 */

import type {
  AppRecord,
  BaseGuiCapability,
  BaseGuiCapabilityScopes,
  BaseGuiHostActionCapability,
} from "../../../../shared/apps-ipc";
import { studioDataGrantForManifest } from "../../../../shared/apps-surface-ipc";
import type { AppGenerationBuildLedger } from "./app-generation-build-ledger";
import type { AppGenerationBuilder } from "./app-generation-builder";
import type { AppExtensionGenerationPort } from "./app-extension-generation";
import type {
  AppServerCutoverPort,
  PreparedServerCutover,
} from "../server/app-server-cutover";
import type { BaseGuiGrantStore } from "../base-gui/grant-store";
import {
  allParticipantsPromotable,
  conflict,
  decisionPointer,
  promoteBinding,
} from "./app-generation-plan";

type AppGenerationConsentPorts = {
  get(appId: string): AppRecord | undefined;
  enqueue<T>(operation: () => Promise<T>): Promise<T>;
  commitRecord(
    next: AppRecord,
    appId: string,
    previous: AppRecord
  ): Promise<AppRecord>;
  extension(): AppExtensionGenerationPort | null;
  grants(): BaseGuiGrantStore | null;
  builder: AppGenerationBuilder;
  serverCutover(): AppServerCutoverPort | null;
  buildLedger(): AppGenerationBuildLedger | null;
};

export class AppGenerationConsentController {
  constructor(private readonly ports: AppGenerationConsentPorts) {}

  resolveExtension(appId: string, granted: boolean) {
    return this.ports.enqueue(async () => {
      const current = this.ports.get(appId);
      const pending = current?.generationBinding.pending;
      if (!current || !pending) throw new Error("App 没有待同意的 generation");
      const resolution = current.generations.find(
        (item) => item.generationId === pending.generationId
      )?.extensionRequirementResolution;
      const extension = this.ports.extension();
      if (resolution?.kind !== "frozen" || !extension) {
        throw new Error("pending generation 未冻结 extension resolution");
      }
      const consent = await extension.resolveConsent({
        appId,
        frozenSet: resolution.frozenSet,
        consentDecisionId: pending.consentDecisionId,
        expectedConsentRevision: pending.expectedConsentRevision,
        granted,
      });
      const nextPending = {
        ...pending,
        ...consent,
        extensionState: consent.state,
      };
      nextPending.state = allParticipantsPromotable(nextPending)
        ? "ready-to-promote"
        : "consent-required";
      return this.ports.commitRecord(
        {
          ...current,
          generationBinding: {
            ...current.generationBinding,
            pending: nextPending,
          },
        },
        appId,
        current
      );
    });
  }

  resolveBaseGui(
    appId: string,
    grantedCapabilities: readonly BaseGuiCapability[],
    grantedHostActions: readonly BaseGuiHostActionCapability[] = [],
    grantedCapabilityScopes: BaseGuiCapabilityScopes = {}
  ) {
    return this.ports.enqueue(async () => {
      const current = this.ports.get(appId);
      const pending = current?.generationBinding.pending;
      const pointer = pending?.baseGuiDecision;
      const generation = current?.generations.find(
        (item) => item.generationId === pending?.generationId
      );
      const grants = this.ports.grants();
      if (!current || !pending || !pointer || !generation || !grants) {
        throw new Error("App 没有待处理的 Base GUI capability decision");
      }
      const decision = await grants.decide({
        appId,
        generationId: generation.generationId,
        decisionId: pointer.decisionId,
        expectedRevision: pointer.expectedRevision,
        contentDigest: generation.contentDigest,
        grantedCapabilities,
        grantedHostActions,
        grantedCapabilityScopes,
      });
      if (decision.state === "declined") {
        await this.ports.builder.abortGenerationBuild(appId, generation);
        const declined = {
          ...current,
          ...(current.studioGrant?.generationId === generation.generationId
            ? {
                studioGrant: null,
                studioGrantRevision: (current.studioGrantRevision ?? 0) + 1,
              }
            : {}),
          lifecycleRevision: current.lifecycleRevision + 1,
          generations: current.generations.filter(
            (item) => item.generationId !== pending.generationId
          ),
          generationBinding: {
            ...current.generationBinding,
            bindingRevision: current.generationBinding.bindingRevision + 1,
            pending: undefined,
          },
        };
        const committed = await this.ports.commitRecord(
          declined,
          appId,
          current
        );
        await this.ports.builder.discardArtifact(appId, pending.generationId);
        return committed;
      }
      const nextPending = {
        ...pending,
        ...(generation.extensionRequirementResolution.kind === "none"
          ? {
              consentDecisionId: decision.decisionId,
              expectedConsentRevision: decision.revision,
            }
          : {}),
        baseGuiDecision: decisionPointer(decision),
      };
      nextPending.state = allParticipantsPromotable(nextPending)
        ? "ready-to-promote"
        : "consent-required";
      return this.ports.commitRecord(
        {
          ...current,
          generationBinding: {
            ...current.generationBinding,
            pending: nextPending,
          },
        },
        appId,
        current
      );
    });
  }

  abort(appId: string, generationId: string) {
    return this.ports.enqueue(async () => {
      const current = this.ports.get(appId);
      const pending = current?.generationBinding.pending;
      const generation = current?.generations.find(
        (item) => item.generationId === generationId
      );
      if (!current || pending?.generationId !== generationId || !generation) {
        throw conflict("App pending generation 已变化");
      }
      await this.ports.builder.abortGenerationBuild(appId, generation);
      const saved = await this.ports.commitRecord(
        {
          ...current,
          ...(current.studioGrant?.generationId === generationId
            ? {
                studioGrant: null,
                studioGrantRevision: (current.studioGrantRevision ?? 0) + 1,
              }
            : {}),
          lifecycleRevision: current.lifecycleRevision + 1,
          generations: current.generations.filter(
            (item) => item.generationId !== generationId
          ),
          generationBinding: {
            ...current.generationBinding,
            bindingRevision: current.generationBinding.bindingRevision + 1,
            pending: undefined,
          },
        },
        appId,
        current
      );
      await this.ports.builder
        .discardArtifact(appId, generationId)
        .catch(() => undefined);
      return saved;
    });
  }

  async promote(appId: string, expectedConsentRevision: number) {
    const pending = this.ports.get(appId)?.generationBinding.pending;
    const generation = this.ports.get(appId)?.generations.find(
      (item) => item.generationId === pending?.generationId
    );
    const serverCutover = this.ports.serverCutover();
    const prepared =
      pending && generation?.manifest.kind === "server" && serverCutover
        ? await serverCutover.prepare({
            appId,
            generationBuildId: generation.generationBuildId,
            generationId: pending.generationId,
          })
        : null;
    try {
      const promoted = await this.promoteUnlocked(
        appId,
        expectedConsentRevision,
        prepared
      );
      await prepared?.commit();
      return promoted;
    } catch (cause) {
      await prepared?.abort();
      throw cause;
    }
  }

  private promoteUnlocked(
    appId: string,
    expectedConsentRevision: number,
    prepared: PreparedServerCutover | null
  ) {
    return this.ports.enqueue(async () => {
      const current = this.ports.get(appId);
      const pending = current?.generationBinding.pending;
      if (!current || !pending) throw new Error("App 没有待 promote 的 generation");
      if (
        pending.expectedActiveGenerationId !==
        (current.generationBinding.active?.generationId ?? null)
      ) {
        throw conflict("active generation 已变化，pending 失效");
      }
      if (pending.expectedConsentRevision !== expectedConsentRevision) {
        throw conflict("App extension consent revision 已变化");
      }
      const generation = current.generations.find(
        (item) => item.generationId === pending.generationId
      );
      if (!generation) throw new Error("pending generation 不存在");
      if (
        generation.extensionRequirementResolution.kind === "frozen" &&
        !this.ports.extension()?.promotable({
          appId,
          appGenerationId: pending.generationId,
          consentDecisionId: pending.consentDecisionId,
          expectedConsentRevision,
        })
      ) {
        throw conflict("App extension consent 尚未终结或已被撤销");
      }
      if (
        pending.baseGuiDecision &&
        !this.ports.grants()?.promotable({
          appId,
          generationId: generation.generationId,
          contentDigest: generation.contentDigest,
          decisionId: pending.baseGuiDecision.decisionId,
          expectedRevision: pending.baseGuiDecision.expectedRevision,
        })
      ) {
        throw conflict("Base GUI capability consent 尚未终结或已被撤销");
      }
      const studioData = studioDataGrantForManifest(generation.manifest);
      if (
        studioData &&
        (current.studioGrant?.generationId !== generation.generationId ||
          current.studioGrant.contentDigest !== generation.contentDigest)
      ) {
        throw conflict("Studio grant 必须先于 generation promotion 落盘");
      }
      if (
        generation.manifest.kind === "server" &&
        (!prepared || prepared.generationId !== pending.generationId)
      ) {
        throw conflict("server data cutover 与本次 promote 不匹配");
      }
      const promoted = await this.ports.commitRecord(
        promoteBinding(current, generation, pending, prepared?.dataEpochId),
        appId,
        current
      );
      const operation = this.ports
        .buildLedger()
        ?.listNonTerminal(appId)
        .find(
          (item) =>
            item.generationBuildId === generation.generationBuildId
        );
      if (operation) {
        await this.ports.buildLedger()!.advance(
          operation.generationBuildId,
          operation.revision,
          "promoted"
        );
      }
      return promoted;
    });
  }
}
