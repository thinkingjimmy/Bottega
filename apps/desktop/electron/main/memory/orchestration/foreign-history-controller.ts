/**
 * [INPUT]: Depends on the unchanged external source of the fully standardized front-end summary MemorySource Snapshot, current Policy Consent/Space, capture reservation and runtime capability callbacks
 * [OUTPUT]: Provides Foreign SnapshotBoundary Grant for up to one round of snapshot-only deliveries per event-loop tick, complete front-loop water retracement
 * [POS]: The main/memory/orchestration external source history transmitter; It is compatible with the canonical BackfillController and never reads ChatRecord or CLI files
 */

import { createHash } from "node:crypto";
import type { MemorySharingMode } from "../../../../shared/settings-ipc";
import {
  expectedPeerId,
  freezeMemoryValue,
  memorySpaceId,
} from "../core/domain";
import { resolveMemoryScopeSubject } from "../core/memory-scope";
import type { MemoryCaptureController } from "./capture-controller";
import type { MemoryPolicyStore } from "../policy/store";

export type ForeignMemorySourceSnapshot = Readonly<{
  snapshotId: string;
  digest: string;
  source: Readonly<{
    sourceKind: import("../../../../shared/history-import-ipc").HistorySourceKind;
    storageFingerprint: string;
    canonicalNativeId: string;
  }>;
  sourceIncarnation: string;
  projectId: string;
  cwd: string;
  normalizedPrefixDigest: string;
  messages: ReadonlyArray<Readonly<{
    nativeTurnId: string;
    deliverySeq: number;
    role: "user" | "assistant";
    content: string;
    createdAt: number;
    contentDigest: string;
  }>>;
}>;

type Dependencies = {
  policy: MemoryPolicyStore;
  capture: MemoryCaptureController;
  initializeOwners(): Promise<void>;
  active(): Readonly<{
    providerDataInstanceId: string | null;
    sharingMode: MemorySharingMode | null;
    runtimeGeneration: number;
  }>;
  executionEnabled(): boolean;
};

export class MemoryForeignHistoryController {
  constructor(private readonly dependencies: Dependencies) {}

  async import(input: Readonly<{
    grantId: string;
    snapshots: readonly ForeignMemorySourceSnapshot[];
    authorization: Readonly<{
      sharingMode: MemorySharingMode;
      providerId: string | null;
      providerDataInstanceId: string | null;
      consentEpochId: string | null;
    }>;
  }>) {
    await this.dependencies.initializeOwners();
    let policy = this.dependencies.policy.snapshot();
    let consent = this.dependencies.policy.activeConsent(policy);
    const active = this.dependencies.active();
    const instanceId = active.providerDataInstanceId;
    const sharingMode = active.sharingMode;
    if (
      !consent ||
      !instanceId ||
      consent.id !== input.authorization.consentEpochId ||
      consent.providerId !== input.authorization.providerId ||
      instanceId !== input.authorization.providerDataInstanceId ||
      sharingMode !== input.authorization.sharingMode ||
      consent.providerDataInstanceId !== instanceId ||
      (sharingMode !== "group" && sharingMode !== "personal") ||
      consent.sharingMode !== sharingMode ||
      !this.dependencies.executionEnabled()
    ) {
      throw new Error("外源 Memory 导入只允许在已授权且可用的 Group/Personal 范围执行");
    }
    const watermarks: Array<{
      source: string;
      deliverySeq: number;
      contentDigest: string;
      normalizedPrefixDigest: string;
    }> = [];
    let first = true;
    for (const snapshot of input.snapshots) {
      const source = foreignMemorySource(snapshot);
      const sourceSessionKey = `foreign:${sha256(source)}`;
      const subject = resolveMemoryScopeSubject(
        {
          chatId: `foreign_${sha256(source).slice(0, 32)}`,
          incarnationId: snapshot.sourceIncarnation,
          projectId: snapshot.projectId,
        },
        sharingMode,
        policy.state.scopeOwnerId
      );
      let space = this.dependencies.policy.spaceFor(subject, policy);
      let spaceId = memorySpaceId(space);
      const messages = [...snapshot.messages].sort(
        (left, right) => left.deliverySeq - right.deliverySeq
      );
      const assistants = messages.filter(
        (message): message is typeof message & { role: "assistant" } =>
          message.role === "assistant"
      );
      const last = assistants.at(-1);
      if (!last) continue;
      const policyGrantId = `foreign-grant:${sha256(`${input.grantId}\0${source}`)}`;
      await this.dependencies.policy.addBackfillGrant({
        id: policyGrantId,
        boundary: "foreign-snapshot",
        chatIncarnations: [],
        upperSeqBySession: {},
        lowerTime: null,
        snapshotId: snapshot.snapshotId,
        snapshotDigest: snapshot.digest,
        sourceSessionKey,
        upperSeq: last.deliverySeq,
        upperTime: last.createdAt,
        memorySpaceId: spaceId,
        providerDataInstanceId: instanceId,
        consentEpochId: consent.id,
        previewDigest: snapshot.digest,
      });
      policy = this.dependencies.policy.snapshot();
      consent = this.dependencies.policy.activeConsent(policy);
      if (!consent || consent.providerDataInstanceId !== instanceId) {
        throw new Error("Memory Consent 在外源 Grant 签发期间失效");
      }
      space = this.dependencies.policy.spaceFor(subject, policy);
      spaceId = memorySpaceId(space);
      for (const assistant of assistants) {
        if (!first) await nextEventLoopTick();
        first = false;
        const user = messages
          .filter(
            (message): message is typeof message & { role: "user" } =>
              message.role === "user" && message.deliverySeq < assistant.deliverySeq
          )
          .at(-1);
        if (!user) continue;
        const requestId = `foreign:${sha256(
          `${source}\0${assistant.nativeTurnId}\0${assistant.deliverySeq}`
        )}`;
        const context = freezeMemoryValue({
          requestId,
          sharingMode,
          sharingGeneration: consent.sharingGeneration,
          memorySpace: space,
          memorySpaceId: spaceId,
          sourceSessionKey,
          workspaceRealpath: snapshot.cwd,
          policyRevision: policy.state.revision,
          consentEpochId: consent.id,
          providerDataInstanceId: instanceId,
          expectedPeerId: expectedPeerId(spaceId),
          revocationRevision: policy.state.revocationRevision,
          runtimeGeneration: this.dependencies.active().runtimeGeneration,
        });
        const captured = await this.dependencies.capture.captureCanonical({
          context,
          requestId,
          grantId: policyGrantId,
          user: {
            id: `foreign_user_${sha256(`${source}\0${user.nativeTurnId}`)}`,
            role: "user",
            content: user.content,
            createdAt: user.createdAt,
            seq: user.deliverySeq,
          },
          assistant: {
            id: `foreign_assistant_${sha256(`${source}\0${assistant.nativeTurnId}`)}`,
            role: "assistant",
            content: assistant.content,
            createdAt: assistant.createdAt,
            seq: assistant.deliverySeq,
          },
        });
        if (!captured) throw new Error("Memory capability 在外源交付期间失效");
      }
      watermarks.push({
        source,
        deliverySeq: last.deliverySeq,
        contentDigest: last.contentDigest,
        normalizedPrefixDigest: snapshot.normalizedPrefixDigest,
      });
    }
    return watermarks;
  }
}

function foreignMemorySource(snapshot: ForeignMemorySourceSnapshot) {
  return `source:${sha256(JSON.stringify([
    snapshot.source.sourceKind,
    snapshot.source.storageFingerprint,
    snapshot.source.canonicalNativeId,
    snapshot.sourceIncarnation,
  ]))}`;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function nextEventLoopTick() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}
