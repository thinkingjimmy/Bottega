/**
 * [INPUT]: Depends on DurableJson, manifest-owned schema/default identities, canonical preference validation, and cutover CAS identities
 * [OUTPUT]: Provides one allocation-free profile-local preview read, CAS writes/reset with 409 conflict semantics, idempotent reset adoption, a single all-App retention sweep that writes only when a slot actually changes, and durable delete tombstones
 * [POS]: App preferences durable authority; package/share and Base business state never enter this store
 */

import { join } from "node:path";
import { z } from "zod";
import type { Sha256Digest } from "../../../../shared/extensions-ipc";
import { DurableJson } from "../../persistence/durable-json";
import {
  preferenceBytes,
  validatePreferenceSchema,
  validatePreferenceValue,
  type PreferenceJsonSchema,
} from "./schema";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/).transform((value) => value as Sha256Digest);
const slotSchema = z.object({
  schemaVersion: z.number().int().positive(),
  schemaDigest: digestSchema,
  defaultsDigest: digestSchema,
  value: z.unknown(),
  appliedCutoverId: z.string().min(1).nullable(),
  retainedByGenerationIds: z.array(z.string().min(1)),
}).strict();
const profileSchema = z.object({
  appId: z.string().min(1),
  profileId: z.string().min(1).max(120),
  revision: z.number().int().nonnegative(),
  activeSchemaDigest: digestSchema.nullable(),
  slots: z.array(slotSchema).max(16),
}).strict();
const tombstoneSchema = z.object({
  appId: z.string().min(1),
  profileId: z.string().min(1).max(120),
  state: z.literal("preferences-delete-pending"),
}).strict();
const fileSchema = z.object({
  schemaVersion: z.literal(1),
  profiles: z.array(profileSchema),
  tombstones: z.array(tombstoneSchema),
}).strict();
type File = z.infer<typeof fileSchema>;

export type PreferenceContract = Readonly<{
  schemaVersion: number;
  schemaDigest: Sha256Digest;
  defaultsDigest: Sha256Digest;
  schema: PreferenceJsonSchema;
  defaults: unknown;
}>;

export class AppPreferencesStore {
  private readonly file: DurableJson<File>;

  constructor(userData: string) {
    this.file = new DurableJson(
      join(userData, "apps", "preferences.json"),
      fileSchema,
      () => ({ schemaVersion: 1, profiles: [], tombstones: [] })
    );
  }

  initialize() {
    return this.file.initialize();
  }

  closeAndFlush() {
    return this.file.closeAndFlush();
  }

  /* 只有 preview 一个读入口：运行期读与切换预演本就是同一个问题的两个视角，
     多一个 read() 就多一份「当前 schema 是什么」的真相。 */
  /* contract 在进入 runtime 缓存那一刻已经验过一次，且它是不可变的：每次读
     都重跑 schema/默认值校验与规范化字节，是把常量当变量算。 */
  preview(appId: string, profileId: string, contract: PreferenceContract) {
    const state = this.file.snapshot();
    assertNotDeleting(state, appId, profileId);
    const profile = findProfile(state, appId, profileId);
    const slot = profile?.slots.find((item) => item.schemaDigest === contract.schemaDigest);
    if (profile?.activeSchemaDigest === contract.schemaDigest && slot) {
      return { mode: "current" as const, schemaDigest: contract.schemaDigest, revision: profile.revision, value: slot.value };
    }
    return {
      mode: "adoption-preview" as const,
      targetSchemaDigest: contract.schemaDigest,
      expectedStoreRevision: profile?.revision ?? 0,
      fromSchemaDigest: profile?.activeSchemaDigest ?? null,
      value: structuredClone(contract.defaults),
    };
  }

  write(input: {
    appId: string;
    profileId: string;
    contract: PreferenceContract;
    expectedRevision: number;
    value: unknown;
  }) {
    assertPreferenceContract(input.contract);
    assertValue(input.value, input.contract);
    return this.file.mutate((state) => {
      assertNotDeleting(state, input.appId, input.profileId);
      const profile = requireProfile(state, input.appId, input.profileId);
      if (profile.revision !== input.expectedRevision) throw preferenceError("preference_conflict");
      if (profile.activeSchemaDigest !== input.contract.schemaDigest) throw preferenceError("preference_schema_changed");
      const slot = profile.slots.find((item) => item.schemaDigest === input.contract.schemaDigest);
      if (!slot) throw preferenceError("preference_schema_changed");
      slot.value = structuredClone(input.value);
      profile.revision += 1;
      return { schemaDigest: slot.schemaDigest, revision: profile.revision, value: slot.value };
    });
  }

  reset(input: Omit<Parameters<AppPreferencesStore["write"]>[0], "value">) {
    return this.write({ ...input, value: input.contract.defaults });
  }

  adoptReset(input: {
    cutoverId: string;
    appId: string;
    profileId: string;
    expectedStoreRevision: number;
    fromSchemaDigest: Sha256Digest | null;
    contract: PreferenceContract;
    retainPreviousForGenerationId?: string;
  }) {
    assertPreferenceContract(input.contract);
    return this.file.mutate((state) => {
      assertNotDeleting(state, input.appId, input.profileId);
      const profile = findProfile(state, input.appId, input.profileId) ?? createProfile(state, input.appId, input.profileId);
      const applied = profile.slots.find((slot) => slot.appliedCutoverId === input.cutoverId);
      if (applied) return { schemaDigest: applied.schemaDigest, revision: profile.revision, value: applied.value };
      if (profile.revision !== input.expectedStoreRevision || profile.activeSchemaDigest !== input.fromSchemaDigest) {
        throw preferenceError("preference_conflict");
      }
      if (input.retainPreviousForGenerationId && profile.activeSchemaDigest) {
        const previous = profile.slots.find((slot) => slot.schemaDigest === profile.activeSchemaDigest);
        if (previous && !previous.retainedByGenerationIds.includes(input.retainPreviousForGenerationId)) {
          previous.retainedByGenerationIds.push(input.retainPreviousForGenerationId);
        }
      }
      const target = profile.slots.find((slot) => slot.schemaDigest === input.contract.schemaDigest) ?? slotSchema.parse({
        schemaVersion: input.contract.schemaVersion,
        schemaDigest: input.contract.schemaDigest,
        defaultsDigest: input.contract.defaultsDigest,
        value: input.contract.defaults,
        appliedCutoverId: input.cutoverId,
        retainedByGenerationIds: [],
      });
      target.value = structuredClone(input.contract.defaults);
      target.appliedCutoverId = input.cutoverId;
      if (!profile.slots.includes(target)) profile.slots.push(target);
      profile.activeSchemaDigest = input.contract.schemaDigest;
      profile.slots = profile.slots.filter((slot) =>
        slot.schemaDigest === profile.activeSchemaDigest || slot.retainedByGenerationIds.length > 0
      );
      profile.revision += 1;
      return { schemaDigest: target.schemaDigest, revision: profile.revision, value: target.value };
    });
  }

  releaseGeneration(appId: string, generationId: string) {
    return this.file.mutate((state) => {
      for (const profile of state.profiles.filter((item) => item.appId === appId)) {
        profile.slots.forEach((slot) => {
          slot.retainedByGenerationIds = slot.retainedByGenerationIds.filter((id) => id !== generationId);
        });
        profile.slots = profile.slots.filter((slot) =>
          slot.schemaDigest === profile.activeSchemaDigest || slot.retainedByGenerationIds.length > 0);
      }
    });
  }

  /* 启动期一次扫完所有 App，而且只在真的有槽位要收时才落一次盘。逐 App
     mutate 会把 preferences.json 完整重写 N 遍，其中绝大多数轮次零变更。 */
  async retainGenerations(retention: ReadonlyMap<string, ReadonlySet<string>>) {
    const dryRun = this.file.snapshot().profiles.some((profile) =>
      pruneRetention(profile, retention.get(profile.appId))
    );
    if (!dryRun) return;
    await this.file.mutate((state) => {
      for (const profile of state.profiles) {
        pruneRetention(profile, retention.get(profile.appId));
      }
    });
  }

  async deleteApp(appId: string) {
    const profiles = this.file.snapshot().profiles.filter((profile) => profile.appId === appId);
    await this.file.mutate((state) => {
      for (const profile of profiles) {
        if (!state.tombstones.some((item) => item.appId === appId && item.profileId === profile.profileId)) {
          state.tombstones.push({ appId, profileId: profile.profileId, state: "preferences-delete-pending" });
        }
      }
    });
    await this.file.mutate((state) => {
      state.profiles = state.profiles.filter((profile) => profile.appId !== appId);
      state.tombstones = state.tombstones.filter((item) => item.appId !== appId);
    });
  }
}

/** 契约进入 runtime 缓存时验一次；写路径再验一次，因为写才是不可逆的那一侧。 */
export function assertPreferenceContract(contract: PreferenceContract) {
  if (!validatePreferenceSchema(contract.schema) || !validatePreferenceValue(contract.defaults, contract.schema)) {
    throw preferenceError("preference_schema_invalid");
  }
  assertValue(contract.defaults, contract);
}

function assertValue(value: unknown, contract: PreferenceContract) {
  if (!validatePreferenceValue(value, contract.schema)) throw preferenceError("preference_value_invalid");
  if (preferenceBytes(value) > 65_536) throw preferenceError("preference_limit");
}

/** 同一段收敛逻辑既跑在快照上判「要不要写」，也跑在真状态上执行写。 */
function pruneRetention(
  profile: File["profiles"][number],
  retained: ReadonlySet<string> | undefined
) {
  if (!retained) return false;
  let changed = false;
  for (const slot of profile.slots) {
    const kept = slot.retainedByGenerationIds.filter((id) => retained.has(id));
    if (kept.length === slot.retainedByGenerationIds.length) continue;
    slot.retainedByGenerationIds = kept;
    changed = true;
  }
  const slots = profile.slots.filter((slot) =>
    slot.schemaDigest === profile.activeSchemaDigest || slot.retainedByGenerationIds.length > 0
  );
  if (slots.length !== profile.slots.length) changed = true;
  profile.slots = slots;
  return changed;
}

function findProfile(state: File, appId: string, profileId: string) {
  return state.profiles.find((item) => item.appId === appId && item.profileId === profileId);
}

function requireProfile(state: File, appId: string, profileId: string) {
  const profile = findProfile(state, appId, profileId);
  if (!profile) throw preferenceError("preference_transitioning");
  return profile;
}

function createProfile(state: File, appId: string, profileId: string) {
  const profile = profileSchema.parse({ appId, profileId, revision: 0, activeSchemaDigest: null, slots: [] });
  state.profiles.push(profile);
  return profile;
}

function assertNotDeleting(state: File, appId: string, profileId: string) {
  if (state.tombstones.some((item) => item.appId === appId && item.profileId === profileId)) {
    throw preferenceError("app_deleted");
  }
}

/* 冲突语义统一走 409：schema 变更与 revision 冲突都是「你看到的世界已经
   过期」，不是「你发来的东西非法」。运行期层曾经用 409、存储层用 400，
   同一件事有两个 status 就等于没有契约。 */
const CONFLICT_CODES = new Set(["preference_conflict", "preference_schema_changed"]);

function preferenceError(code: string) {
  return Object.assign(new Error(code), {
    code,
    status: CONFLICT_CODES.has(code) ? 409 : 400,
  });
}
