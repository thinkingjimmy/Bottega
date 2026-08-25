/**
 * [INPUT]: Depends on shared Apps' chat/project tri-mode recording and App default global licensing
 * [OUTPUT]: Provides resolve AppGrant purely function; In-Level Disabled, Short-Layer, Interlayer is authorizing broad integration and provenance
 * [POS]: The authoritative semantics of apps/attachments; effective/listAvailable/conversion/surface can be consumed here only, and individual handwriting and assembly are prohibited
 */

import {
  isPositiveAppGrant,
  type AppCapabilityGrant,
  type AppGrantRecord,
} from "../../../../shared/apps-ipc";

type Source = "chat" | "project" | "global";

export type GrantResolution = Readonly<{
  effective: AppCapabilityGrant | null;
  provenance: Readonly<{
    winner: Source | null;
    contributors: readonly Source[];
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
  if (isDisabled(input.project)) {
    return direct
      ? merge(input.appId, [["chat", direct]], "project")
      : suppressed("project");
  }

  const candidates: Array<readonly [Source, AppCapabilityGrant]> = [];
  if (direct) candidates.push(["chat", direct]);
  const inherited = positive(input.project);
  if (inherited) candidates.push(["project", inherited]);
  if (input.global) candidates.push(["global", input.global]);
  return merge(input.appId, candidates, null);
}

function merge(
  appId: string,
  candidates: readonly (readonly [Source, AppCapabilityGrant])[],
  suppressedBy: "chat" | "project" | null
): GrantResolution {
  if (!candidates.length) return suppressed(suppressedBy);
  let data: AppCapabilityGrant["data"];
  let winner = candidates[0][0];
  let grantedAt = 0;
  let fileRead = false;
  let useData = false;
  for (const [source, grant] of candidates) {
    if (dataRank(grant.data) > dataRank(data)) {
      data = grant.data;
      winner = source;
    }
    grantedAt = Math.max(grantedAt, grant.grantedAt);
    fileRead ||= grant.agentDelegation.fileRead;
    useData ||= grant.agentDelegation.useData;
  }
  return {
    effective: {
      appId,
      ...(data ? { data: structuredClone(data) } : {}),
      agentDelegation: { fileRead, useData },
      grantedAt,
    },
    provenance: {
      winner,
      contributors: candidates.map(([source]) => source),
      suppressedBy,
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
    provenance: { winner: null, contributors: [], suppressedBy },
  };
}

function dataRank(data: AppCapabilityGrant["data"] | undefined) {
  if (!data) return 0;
  return data.level === "read" ? 1 : 2;
}
