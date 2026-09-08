/**
 * [INPUT]: Depends on strict shared SemVer precedence.
 * [OUTPUT]: Provides the App minimum-host declaration, candidate identity, structured failures and parser.
 * [POS]: Stable reader contract independent of evolving App manifests and GUI protocols.
 */

import { meetsMinimum, parseSemVer } from "./semver";

export const APP_COMPATIBILITY_FILE = "app.compat.json";
export const APP_COMPATIBILITY_SCHEMA = "bottega.app-compat/v1";
export const APP_COMPATIBILITY_BYTE_LIMIT = 16 * 1024;
export const APP_HOST_BASELINE = "0.1.3";
export type AppCompatibilityDeclaration = Readonly<{
  schema: typeof APP_COMPATIBILITY_SCHEMA;
  minBottegaVersion: string;
}>;
export type AppCompatibilityCode =
  | "APP_HOST_UPDATE_REQUIRED"
  | "APP_COMPATIBILITY_MISSING"
  | "APP_COMPATIBILITY_INVALID"
  | "APP_COMPATIBILITY_SCHEMA_UNSUPPORTED"
  | "APP_HOST_VERSION_UNAVAILABLE";
export type AppCandidateIdentity = Readonly<{
  appName: string;
  appId?: string;
  hasUsableVersion?: boolean;
  presetId?: string;
  repoUrl?: string;
  commitSha: string | null;
  contentDigest: string;
}>;
export type AppCompatibilityFailure = Readonly<{
  code: AppCompatibilityCode;
  candidate: AppCandidateIdentity;
  currentVersion: string | null;
  minBottegaVersion: string | null;
  declarationDigest: string | null;
  requestId?: string;
}>;
export type AppCompatibilityBlocked = Readonly<{ kind: "compatibility-blocked"; compatibility: AppCompatibilityFailure }>;
export type AppCompatibilityCheck =
  | { ok: true; declaration: AppCompatibilityDeclaration | null }
  | { ok: false; code: AppCompatibilityCode; minBottegaVersion: string | null };

export function checkAppCompatibility(
  value: unknown,
  currentVersion: string | null,
  required: boolean
): AppCompatibilityCheck {
  if (value === undefined) return required
    ? { ok: false, code: "APP_COMPATIBILITY_MISSING", minBottegaVersion: null }
    : { ok: true, declaration: null };
  const invalid = { ok: false, code: "APP_COMPATIBILITY_INVALID", minBottegaVersion: null } as const;
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid;
  const core = value as Record<string, unknown>;
  if (typeof core.schema !== "string") return invalid;
  if (core.schema !== APP_COMPATIBILITY_SCHEMA) {
    return { ok: false, code: "APP_COMPATIBILITY_SCHEMA_UNSUPPORTED", minBottegaVersion: null };
  }
  if (!parseSemVer(core.minBottegaVersion)) return invalid;
  const minBottegaVersion = core.minBottegaVersion as string;
  if (!parseSemVer(currentVersion)) return { ok: false, code: "APP_HOST_VERSION_UNAVAILABLE", minBottegaVersion };
  if (!meetsMinimum(currentVersion, minBottegaVersion)) return { ok: false, code: "APP_HOST_UPDATE_REQUIRED", minBottegaVersion };
  return { ok: true, declaration: { schema: APP_COMPATIBILITY_SCHEMA, minBottegaVersion } };
}
