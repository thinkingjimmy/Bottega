/**
 * [INPUT]: Depends on main-produced compatibility failures and the durable JSON owner.
 * [OUTPUT]: Provides bounded resumable candidate references and typed IPC rejection envelopes.
 * [POS]: App upgrade return-entry authority; it never stores configuration, preflight or grants.
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import type { AppCompatibilityBlocked, AppCompatibilityFailure } from "../../../../shared/app-host/contract";
import { DurableJson } from "../../persistence/durable-json";
import { AppCompatibilityError } from "./read";

const failureSchema = z.object({
  code: z.enum(["APP_HOST_UPDATE_REQUIRED", "APP_COMPATIBILITY_MISSING", "APP_COMPATIBILITY_INVALID", "APP_COMPATIBILITY_SCHEMA_UNSUPPORTED", "APP_HOST_VERSION_UNAVAILABLE"]),
  candidate: z.object({
    appName: z.string().max(500), appId: z.string().max(80).optional(), hasUsableVersion: z.boolean().optional(), presetId: z.string().max(64).optional(),
    repoUrl: z.string().max(2048).optional(), commitSha: z.string().max(64).nullable(), contentDigest: z.string().max(128),
  }).strict(),
  currentVersion: z.string().max(256).nullable(), minBottegaVersion: z.string().max(256).nullable(),
  declarationDigest: z.string().max(128).nullable(), requestId: z.string().uuid(),
}).strict();
const schema = z.object({ schema: z.literal(1), requests: z.array(failureSchema).max(128) }).strict();

export class AppCompatibilityRequests {
  private readonly file: DurableJson<z.infer<typeof schema>>;
  private readonly listeners = new Set<() => void>();
  onChanged(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed() { for (const listener of this.listeners) { try { listener(); } catch (cause) { console.warn("[apps] compatibility listener failed", cause); } } }
  private ready: Promise<unknown> | null = null;
  constructor(userData: string) {
    this.file = new DurableJson(join(userData, "app-compatibility", "requests.json"), schema, () => ({ schema: 1, requests: [] }));
  }
  private initialize() { return this.ready ??= this.file.initialize(); }
  async list(): Promise<AppCompatibilityFailure[]> {
    await this.initialize();
    return this.file.snapshot().requests;
  }
  async require(requestId: string) {
    const request = (await this.list()).find((item) => item.requestId === requestId);
    if (!request) throw new Error("APP_COMPATIBILITY_REQUEST_UNAVAILABLE");
    return request;
  }
  async remember(failure: AppCompatibilityFailure): Promise<AppCompatibilityFailure> {
    await this.initialize();
    const result = await this.file.mutate((state) => {
      const existing = state.requests.find((item) => sameCandidate(item, failure));
      const value = failureSchema.parse({ ...failure, requestId: existing?.requestId ?? randomUUID() });
      state.requests = [...state.requests.filter((item) => item.requestId !== existing?.requestId), value].slice(-128);
      return value;
    });
    this.changed();
    return result;
  }
  async forget(requestId: string) {
    await this.initialize();
    await this.file.mutate((state) => { state.requests = state.requests.filter((item) => item.requestId !== requestId); });
    this.changed();
  }
  async guard<T>(action: () => Promise<T>): Promise<T | AppCompatibilityBlocked> {
    try {
      const result = await action();
      if (isBlocked(result)) return { kind: "compatibility-blocked", compatibility: await this.remember(result.compatibility) };
      return result;
    } catch (cause) {
      if (!(cause instanceof AppCompatibilityError)) throw cause;
      return { kind: "compatibility-blocked", compatibility: await this.remember(cause.compatibility) };
    }
  }
}

function isBlocked(value: unknown): value is AppCompatibilityBlocked {
  return Boolean(value && typeof value === "object" && "kind" in value && value.kind === "compatibility-blocked");
}
function sameCandidate(left: AppCompatibilityFailure, right: AppCompatibilityFailure) {
  return left.candidate.presetId === right.candidate.presetId && left.candidate.repoUrl === right.candidate.repoUrl &&
    left.candidate.appId === right.candidate.appId && left.candidate.commitSha === right.candidate.commitSha &&
    left.candidate.contentDigest === right.candidate.contentDigest;
}

const owners = new Map<string, AppCompatibilityRequests>();
export function appCompatibilityRequests(userData: string) {
  let owner = owners.get(userData);
  if (!owner) { owner = new AppCompatibilityRequests(userData); owners.set(userData, owner); }
  return owner;
}
