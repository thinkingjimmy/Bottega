/**
 * [INPUT]: Depends on shared Chat/Project App grant records and the global App default grant
 * [OUTPUT]: Provides the pure resolveAppGrant function with Chat → Project → global nearest-scope selection and compact provenance
 * [POS]: Authorization semantic core for apps/attachments; effective, available, conversion and surface paths consume this result instead of recomputing it
 */

import {
  isPositiveAppGrant,
  type AppCapabilityGrant,
  type AppGrantRecord,
} from "../../../../shared/apps-ipc";

type Source = "chat" | "project" | "global";

type GrantResolution = Readonly<{
  effective: AppCapabilityGrant | null;
  provenance: Readonly<{
    effectiveSource: Source | null;
    suppressedBy: "chat" | "project" | null;
  }>;
}>;

export function resolveAppGrant(input: {
  appId: string;
  chat?: AppGrantRecord;
  project?: AppGrantRecord;
  global?: AppCapabilityGrant | null;
}): GrantResolution {
  if (isDisabled(input.chat)) return suppressed("chat");
  const direct = positive(input.chat);
  if (direct) return granted(direct, "chat");
  if (isDisabled(input.project)) return suppressed("project");
  const inherited = positive(input.project);
  if (inherited) return granted(inherited, "project");
  return input.global ? granted(input.global, "global") : suppressed(null);
}

function granted(grant: AppCapabilityGrant, source: Source): GrantResolution {
  return {
    effective: structuredClone(grant),
    provenance: {
      effectiveSource: source,
      suppressedBy: null,
    },
  };
}

function positive(record: AppGrantRecord | undefined) {
  return record && isPositiveAppGrant(record) ? record : undefined;
}

function isDisabled(record: AppGrantRecord | undefined) {
  return Boolean(record && !isPositiveAppGrant(record));
}

function suppressed(
  suppressedBy: "chat" | "project" | null
): GrantResolution {
  return {
    effective: null,
    provenance: { effectiveSource: null, suppressedBy },
  };
}
