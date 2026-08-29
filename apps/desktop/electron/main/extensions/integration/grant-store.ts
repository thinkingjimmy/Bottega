/**
 * [INPUT]: Depends on Node fs/path, zod and frozen App requirement/package generation identities
 * [OUTPUT]: Provides AppExtensionGrantStore: stable decision, exact scoped grants, return grant+tombstone by app generation, only read projections, derive/consent/deny, revoke and single-mode aggregate revision for unaggregated
 * [POS]: The authorized durable single-writer of App×Extension; Grant is not across App generation/resolution/package/config
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  AppExtensionConsentDecision,
  FrozenAppExtensionRequirementSetV1,
  ScopedComponentGrant,
} from "../../../../shared/extensions-ipc";
import { digestCanonical } from "../registry-store";

type AppGrantAggregate = {
  appId: string;
  revision: number;
  decisions: AppExtensionConsentDecision[];
  grants: ScopedComponentGrant[];
  revokeTombstones: Array<{
    appGenerationId: string;
    revision: number;
    revokedAt: number;
  }>;
};

type StoreFile = { schemaVersion: 1; apps: AppGrantAggregate[] };

export type AppGenerationGrantProjection = Readonly<{
  aggregateRevision: number;
  revokedAt: number | null;
  grants: readonly ScopedComponentGrant[];
}>;

export class AppExtensionGrantStore {
  readonly filePath: string;
  private state: StoreFile = { schemaVersion: 1, apps: [] };
  private serial = Promise.resolve();

  constructor(userData: string) {
    this.filePath = join(userData, "agent-extensions", "app-grants.json");
  }

  async initialize() {
    try {
      this.state = validateStore(JSON.parse(await readFile(this.filePath, "utf8")));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      await this.persist();
    }
  }

  snapshot(appId: string) {
    return structuredClone(this.aggregate(appId, false));
  }

  createDecision(input: {
    appId: string;
    set: FrozenAppExtensionRequirementSetV1;
    deriveFromGenerationId?: string;
  }) {
    return this.mutate(() => {
      const aggregate = this.aggregate(input.appId, true)!;
      const existing = aggregate.decisions.find(
        (item) => item.pendingAppGenerationId === input.set.appGenerationId
      );
      if (existing) return existing;
      const consentRevision = aggregate.revision + 1;
      const base = {
        decisionId: randomUUID(),
        appId: input.appId,
        pendingAppGenerationId: input.set.appGenerationId,
        requirementResolutionDigest: input.set.resolutionDigest,
        consentRevision,
      };
      const source = input.deriveFromGenerationId
        ? this.derivationSource(aggregate, input.deriveFromGenerationId)
        : undefined;
      let decision: AppExtensionConsentDecision;
      if (source && canDerive(input.set, source.grants)) {
        const grants = exactGrants(input.appId, input.set, consentRevision);
        const grantSetDigest = digestCanonical(grants);
        aggregate.grants.push(...grants);
        decision = {
          ...base,
          status: "derived",
          grantSetDigest,
          derivedFrom: {
            appGenerationId: input.deriveFromGenerationId!,
            grantSetDigest: source.decision.grantSetDigest,
          },
        };
      } else {
        decision = { ...base, status: "consent-required" };
      }
      aggregate.decisions.push(decision);
      aggregate.revision = consentRevision;
      return structuredClone(decision);
    });
  }

  decide(input: {
    appId: string;
    decisionId: string;
    expectedConsentRevision: number;
    set: FrozenAppExtensionRequirementSetV1;
    granted: boolean;
  }) {
    return this.mutate(() => {
      const aggregate = this.requireAggregate(input.appId);
      const index = aggregate.decisions.findIndex(
        (item) => item.decisionId === input.decisionId
      );
      const current = aggregate.decisions[index];
      if (!current) throw new Error("App extension consent decision 不存在");
      if (current.status !== "consent-required") return structuredClone(current);
      if (
        current.consentRevision !== input.expectedConsentRevision ||
        current.requirementResolutionDigest !== input.set.resolutionDigest ||
        current.pendingAppGenerationId !== input.set.appGenerationId
      ) {
        throw Object.assign(new Error("App extension consent fence 已变化"), {
          status: 409,
        });
      }
      const revision = aggregate.revision + 1;
      const grants = input.granted
        ? exactGrants(input.appId, input.set, revision)
        : [];
      const grantSetDigest = digestCanonical(grants);
      const decision: AppExtensionConsentDecision = {
        ...current,
        consentRevision: revision,
        status: input.granted ? "granted" : "denied",
        grantSetDigest,
      };
      aggregate.decisions[index] = decision;
      aggregate.grants.push(...grants);
      aggregate.revision = revision;
      return structuredClone(decision);
    });
  }

  revoke(appId: string, appGenerationId: string, now = Date.now()) {
    return this.mutate(() => {
      /* 没有 aggregate = 这个 App 从未声明过扩展，一张 grant 都没发过——
         「撤销后不再有任何有效 grant」这条后置条件已然成立，不是错误。
         读侧 exactGrants 早把「无 aggregate」与「已 revoke」同等对待（都返回
         []），写侧再抛就是同一状态两套判定：删除 saga 的 grants-settled 逐代
         revoke，于是任何未声明扩展的 App 都永远删不掉。空 aggregate 也不值得
         立碑——generationId 不复用，墓碑没有可挡的未来。 */
      const aggregate = this.aggregate(appId, false);
      if (!aggregate) return undefined;
      const existing = aggregate.revokeTombstones.find(
        (item) => item.appGenerationId === appGenerationId
      );
      if (existing) return structuredClone(existing);
      const tombstone = {
        appGenerationId,
        revision: aggregate.revision + 1,
        revokedAt: now,
      };
      aggregate.revision = tombstone.revision;
      aggregate.grants = aggregate.grants.filter(
        (item) => item.appGenerationId !== appGenerationId
      );
      aggregate.revokeTombstones.push(tombstone);
      return structuredClone(tombstone);
    });
  }

  exactGrants(appId: string, appGenerationId: string) {
    const aggregate = this.aggregate(appId, false);
    if (
      !aggregate ||
      aggregate.revokeTombstones.some(
        (item) => item.appGenerationId === appGenerationId
      )
    ) {
      return [];
    }
    return structuredClone(
      aggregate.grants.filter((item) => item.appGenerationId === appGenerationId)
    );
  }

  /** App UI 只读这个 generation-scoped 投影，不从 resolution 反推 grant。 */
  generationProjection(
    appId: string,
    appGenerationId: string
  ): AppGenerationGrantProjection {
    const aggregate = this.aggregate(appId, false);
    const tombstone = aggregate?.revokeTombstones.find(
      (item) => item.appGenerationId === appGenerationId
    );
    return {
      aggregateRevision: aggregate?.revision ?? 0,
      revokedAt: tombstone?.revokedAt ?? null,
      grants: tombstone
        ? []
        : structuredClone(
            aggregate?.grants.filter(
              (item) => item.appGenerationId === appGenerationId
            ) ?? []
          ),
    };
  }

  private derivationSource(aggregate: AppGrantAggregate, appGenerationId: string) {
    if (
      aggregate.revokeTombstones.some(
        (item) => item.appGenerationId === appGenerationId
      )
    ) {
      return undefined;
    }
    const decision = aggregate.decisions.find(
      (item) =>
        item.pendingAppGenerationId === appGenerationId &&
        item.status !== "consent-required"
    );
    if (
      !decision ||
      decision.status === "denied" ||
      decision.status === "consent-required"
    ) {
      return undefined;
    }
    return {
      decision,
      grants: aggregate.grants.filter((item) => item.appGenerationId === appGenerationId),
    };
  }

  private aggregate(appId: string, create: boolean) {
    let aggregate = this.state.apps.find((item) => item.appId === appId);
    if (!aggregate && create) {
      aggregate = {
        appId,
        revision: 0,
        decisions: [],
        grants: [],
        revokeTombstones: [],
      };
      this.state.apps.push(aggregate);
    }
    return aggregate;
  }

  private requireAggregate(appId: string) {
    const aggregate = this.aggregate(appId, false);
    if (!aggregate) throw new Error("App extension grant aggregate 不存在");
    return aggregate;
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
      const value = operation();
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

function exactGrants(
  appId: string,
  set: FrozenAppExtensionRequirementSetV1,
  revision: number
): ScopedComponentGrant[] {
  return set.extensionRequirements.flatMap((entry) =>
    entry.state === "resolved"
      ? [
          {
            appId,
            appGenerationId: set.appGenerationId,
            requirementResolutionDigest: set.resolutionDigest,
            declarationDigest: entry.declarationDigest,
            componentInstanceIdentity: entry.componentInstanceIdentity,
            packageGenerationRef: entry.packageGenerationRef,
            resolvedConfigDigest: entry.resolvedConfigDigest,
            grantRevision: revision,
            grantedAt: Date.now(),
          },
        ]
      : []
  );
}

function canDerive(
  target: FrozenAppExtensionRequirementSetV1,
  source: readonly ScopedComponentGrant[]
) {
  return target.extensionRequirements.every((entry) => {
    if (entry.state !== "resolved") return !entry.required;
    return source.some(
      (grant) =>
        grant.componentInstanceIdentity === entry.componentInstanceIdentity &&
        grant.packageGenerationRef.packageGenerationId ===
          entry.packageGenerationRef.packageGenerationId &&
        grant.packageGenerationRef.recordDigest === entry.packageGenerationRef.recordDigest &&
        grant.resolvedConfigDigest === entry.resolvedConfigDigest
    );
  });
}

function validateStore(value: unknown): StoreFile {
  if (!value || typeof value !== "object") throw new Error("App grant store 无效");
  const record = value as Partial<StoreFile>;
  if (record.schemaVersion !== 1 || !Array.isArray(record.apps)) {
    throw new Error("App grant store schema 无效");
  }
  return structuredClone(record as StoreFile);
}
