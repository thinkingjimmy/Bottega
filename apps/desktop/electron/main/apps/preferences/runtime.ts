/**
 * [INPUT]: Depends on AppStore generation artifacts, sealed preference manifests, App-global cutover intents, canonical digests, and AppPreferencesStore
 * [OUTPUT]: Provides digest-keyed cached generation contracts validated once on cache entry, staging-frozen cutover adoption/validation, active-generation-only reset self-heal, one-sweep durable-retirement reconciliation, first-install adoption, profile-local reads, and CAS writes/reset
 * [POS]: Runtime bridge between a live Base GUI binding and the durable preference authority
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { BaseGuiLiveBinding } from "../../../../shared/apps-ipc";
import type { AppGuiGenerationIntent } from "../../../../shared/app-gui/cutover";
import type { AppGuiPreferenceAdoptionSnapshot } from "../../../../shared/app-gui/cutover";
import { canonicalJson, sha256 } from "../gui-build/metadata";
import type { AppStore } from "../store/app-store";
import type { PreferenceJsonSchema } from "./schema";
import {
  AppPreferencesStore,
  assertPreferenceContract,
  type PreferenceContract,
} from "./store";

/* 生成物是封存的，同一个 (generationId, schemaDigest, defaultsDigest) 三元组
   永远对应同一份磁盘字节；缓存键带上 digest，manifest 一变键就变，缓存自己
   失效，不需要额外的清除通道。 */
const CONTRACT_CACHE_LIMIT = 16;

export class AppPreferencesRuntime {
  readonly store: AppPreferencesStore;
  private readonly contracts = new Map<string, PreferenceContract>();

  constructor(userData: string, private readonly apps: AppStore) {
    this.store = new AppPreferencesStore(userData);
  }

  initialize() {
    return this.store.initialize();
  }

  closeAndFlush() {
    return this.store.closeAndFlush();
  }

  reconcileGenerationRetention() {
    return this.store.retainGenerations(
      new Map(this.apps.list().map((record) => [
        record.id,
        new Set(record.generationBinding.drainingGenerationIds),
      ]))
    );
  }

  async read(binding: BaseGuiLiveBinding) {
    const contract = await this.contract(binding);
    const preview = this.store.preview(binding.appId, "local", contract);
    return preview.mode === "current"
      ? { ...preview, state: "current" as const }
      : {
          state: "schema-changed" as const,
          code: "preference_schema_changed" as const,
          schemaDigest: preview.targetSchemaDigest,
          revision: preview.expectedStoreRevision,
          value: preview.value,
        };
  }

  async write(input: {
    binding: BaseGuiLiveBinding;
    expectedRevision: number;
    reset: boolean;
    value?: unknown;
  }) {
    const contract = await this.contract(input.binding);
    const preview = this.store.preview(input.binding.appId, "local", contract);
    if (input.reset && preview.mode === "adoption-preview") {
      /* 这条自愈路径会在普通 POST 里执行 adoptReset，绕过 cutover 屏障。
         只允许「活跃世代 + 没有待晋升的候选世代」发起：draining 的旧世代
         不得把自己的 schema 写成当前真相，晋升在途时也必须让位给 cutover
         自己那份被冻结的 revision 快照。 */
      this.assertSelfHealAdmissible(input.binding);
      if (preview.expectedStoreRevision !== input.expectedRevision) {
        throw preferenceError("preference_conflict", 409);
      }
      return this.store.adoptReset({
        cutoverId: `reset:${input.binding.generationId}:${input.expectedRevision}`,
        appId: input.binding.appId,
        profileId: "local",
        expectedStoreRevision: preview.expectedStoreRevision,
        fromSchemaDigest: preview.fromSchemaDigest,
        contract,
      });
    }
    return input.reset
      ? this.store.reset({
          appId: input.binding.appId,
          profileId: "local",
          contract,
          expectedRevision: input.expectedRevision,
        })
      : this.store.write({
          appId: input.binding.appId,
          profileId: "local",
          contract,
          expectedRevision: input.expectedRevision,
          value: input.value,
        });
  }

  async ensureInitial(binding: BaseGuiLiveBinding | null) {
    if (!binding) return;
    const generation = this.generation(binding);
    if (generation?.manifest.kind !== "base" || !generation.manifest.gui?.preferences) return;
    const contract = await this.contract(binding);
    const preview = this.store.preview(binding.appId, "local", contract);
    if (preview.mode !== "adoption-preview" || preview.fromSchemaDigest !== null) return;
    await this.store.adoptReset({
      cutoverId: `initial:${binding.generationId}`,
      appId: binding.appId,
      profileId: "local",
      expectedStoreRevision: preview.expectedStoreRevision,
      fromSchemaDigest: null,
      contract,
    });
  }

  async adoptCutover(intent: AppGuiGenerationIntent) {
    const snapshot = intent.preferenceAdoption;
    if (!snapshot) return;
    const binding = this.cutoverBinding(intent.appId, intent.nextGenerationId, intent.next.decisionId);
    const contract = await this.contract(binding);
    this.assertSnapshotContract(snapshot, contract);
    await this.store.adoptReset({
      cutoverId: intent.cutoverId,
      appId: intent.appId,
      profileId: snapshot.profileId,
      expectedStoreRevision: snapshot.expectedStoreRevision,
      fromSchemaDigest: snapshot.fromSchemaDigest,
      contract,
      ...(intent.previous
        ? { retainPreviousForGenerationId: intent.previous.generationId }
        : {}),
    });
  }

  async previewCutover(appId: string, generationId: string): Promise<AppGuiPreferenceAdoptionSnapshot | null> {
    const generation = this.apps.get(appId)?.generations.find((item) => item.generationId === generationId);
    if (generation?.manifest.kind !== "base" || !generation.manifest.gui?.preferences) return null;
    const contract = await this.contract(this.cutoverBinding(appId, generationId, null));
    const preview = this.store.preview(appId, "local", contract);
    if (preview.mode === "current") return null;
    return {
      profileId: "local",
      expectedStoreRevision: preview.expectedStoreRevision,
      fromSchemaDigest: preview.fromSchemaDigest,
      targetSchemaDigest: contract.schemaDigest,
      defaultsDigest: contract.defaultsDigest,
    };
  }

  async validateCutover(intent: AppGuiGenerationIntent) {
    const snapshot = intent.preferenceAdoption;
    if (!snapshot) return;
    const contract = await this.contract(
      this.cutoverBinding(intent.appId, intent.nextGenerationId, intent.next.decisionId)
    );
    this.assertSnapshotContract(snapshot, contract);
    const preview = this.store.preview(intent.appId, snapshot.profileId, contract);
    if (
      preview.mode !== "adoption-preview" ||
      preview.expectedStoreRevision !== snapshot.expectedStoreRevision ||
      preview.fromSchemaDigest !== snapshot.fromSchemaDigest
    ) throw preferenceError("preference_conflict", 409);
  }

  private async contract(binding: BaseGuiLiveBinding): Promise<PreferenceContract> {
    const generation = this.generation(binding);
    const manifest = generation?.manifest.kind === "base"
      ? generation.manifest.gui?.preferences
      : undefined;
    if (!generation || !manifest || generation.contentLayoutVersion !== 3) {
      throw preferenceError("preferences_unavailable", 404);
    }
    const key = `${binding.appId}:${binding.generationId}:${manifest.schemaDigest}:${manifest.defaultsDigest}`;
    const cached = this.contracts.get(key);
    if (cached) return cached;
    const sourceRoot = join(this.apps.artifactRoot(binding.appId, binding.generationId), "source");
    const [schema, defaults] = await Promise.all([
      readJson(join(sourceRoot, manifest.schema)),
      readJson(join(sourceRoot, manifest.defaults)),
    ]);
    if (
      sha256(Buffer.from(canonicalJson(schema))) !== manifest.schemaDigest ||
      sha256(Buffer.from(canonicalJson(defaults))) !== manifest.defaultsDigest
    ) {
      throw preferenceError("preference_schema_changed", 409);
    }
    const contract: PreferenceContract = {
      schemaVersion: manifest.schemaVersion,
      schemaDigest: manifest.schemaDigest,
      defaultsDigest: manifest.defaultsDigest,
      schema: schema as PreferenceJsonSchema,
      defaults,
    };
    /* 校验属于「契约进入缓存」这一刻，不属于每一次读：contract 不可变，
       同一份字节验一万遍也只会得到同一个结论。 */
    assertPreferenceContract(contract);
    this.contracts.set(key, contract);
    while (this.contracts.size > CONTRACT_CACHE_LIMIT) {
      this.contracts.delete(this.contracts.keys().next().value as string);
    }
    return contract;
  }

  /* pending 候选存在即视为 cutover 在途。这里不去看 draining 世代：适配
     已由 activeGenerationId 判等挡住，而 draining 可能长期存在，拿它当闸门
     会把自愈永久关死。 */
  private assertSelfHealAdmissible(binding: BaseGuiLiveBinding) {
    const facts = this.apps.routingFacts(binding.appId);
    if (
      facts?.activeGenerationId !== binding.generationId ||
      facts.pendingGeneration
    ) {
      throw preferenceError("preference_transitioning", 409);
    }
  }

  private generation(binding: BaseGuiLiveBinding) {
    return this.apps.get(binding.appId)?.generations.find(
      (item) => item.generationId === binding.generationId
    );
  }

  private cutoverBinding(appId: string, generationId: string, decisionId: string | null): BaseGuiLiveBinding {
    const record = this.apps.get(appId);
    const generation = record?.generations.find((item) => item.generationId === generationId);
    if (!record || !generation) throw preferenceError("preferences_unavailable", 404);
    return {
      appId,
      generationId,
      contentDigest: generation.contentDigest,
      lifecycleRevision: record.lifecycleRevision,
      baseCapabilities: [],
      hostActions: [],
      workspaceReadScope: null,
      surfaceId: "cutover-preferences",
      appSurfaceLeaseId: null,
      capabilityDecisionId: decisionId,
      capabilityRevision: 0,
    };
  }

  private assertSnapshotContract(snapshot: AppGuiPreferenceAdoptionSnapshot, contract: PreferenceContract) {
    if (
      snapshot.targetSchemaDigest !== contract.schemaDigest ||
      snapshot.defaultsDigest !== contract.defaultsDigest
    ) throw preferenceError("preference_schema_changed", 409);
  }
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function preferenceError(code: string, status: number) {
  return Object.assign(new Error(code), { code, status });
}
