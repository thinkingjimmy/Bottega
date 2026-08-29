/**
 * [INPUT]: Depends on package/manual subjects with neutral resource scope, protocol-level evidence digests, and authoritative inventory
 * [OUTPUT]: Provides ComponentHealthAuthority single-writer observation, indexed backoff, exact-Project cleanup, server-by-server isolation, and authoritative manual UI projection
 * [POS]: The MCP runtime-health single-writer of extensions; The spawn event is not in the API and therefore cannot be disguised as observed-success
 */

import type {
  ExtensionInventorySnapshot,
  McpComponentHealthRecord,
  McpComponentHealthSubject,
  Sha256Digest,
} from "../../../shared/extensions-ipc";
import type {
  ManualMcpServerView,
  McpServerHealthView,
} from "../../../shared/mcp-servers-ipc";
import { digestCanonical } from "./registry-store";

const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

export class ComponentHealthAuthority {
  private readonly records = new Map<string, McpComponentHealthRecord>();

  observeProtocolSuccess(
    subject: McpComponentHealthSubject,
    evidenceDigest: Sha256Digest,
    observedAt = Date.now()
  ) {
    return this.write(subject, {
      state: "healthy",
      evidence: "protocol-success",
      evidenceDigest,
      consecutiveFailures: 0,
      observedAt,
      retryAt: null,
    });
  }

  observeProtocolFailure(
    subject: McpComponentHealthSubject,
    evidenceDigest: Sha256Digest,
    observedAt = Date.now()
  ) {
    const failures = (this.records.get(subjectKey(subject))?.consecutiveFailures ?? 0) + 1;
    const delay = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (failures - 1));
    return this.write(subject, {
      state: "degraded",
      evidence: "protocol-failure",
      evidenceDigest,
      consecutiveFailures: failures,
      observedAt,
      retryAt: observedAt + delay,
    });
  }

  quarantine(
    subject: McpComponentHealthSubject,
    evidenceDigest: Sha256Digest,
    observedAt = Date.now()
  ) {
    return this.write(subject, {
      state: "quarantined",
      evidence: "custody-quarantine",
      evidenceDigest,
      consecutiveFailures:
        (this.records.get(subjectKey(subject))?.consecutiveFailures ?? 0) + 1,
      observedAt,
      retryAt: null,
    });
  }

  snapshot() {
    return [...this.records.values()]
      .sort((left, right) => subjectKey(left.subject).localeCompare(subjectKey(right.subject)))
      .map((record) => structuredClone(record));
  }

  clearProject(projectId: string) {
    let removed = 0;
    for (const [key, record] of this.records) {
      if (
        record.subject.kind === "manual" &&
        record.subject.scope.kind === "project" &&
        record.subject.scope.projectId === projectId
      ) {
        this.records.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  inventory(snapshot: ExtensionInventorySnapshot): ExtensionInventorySnapshot {
    const health = this.snapshot().filter((record) => record.subject.kind === "package");
    const { digest: _digest, ...inventory } = snapshot;
    const payload = {
      ...inventory,
      health,
    };
    return { ...structuredClone(payload), digest: digestCanonical(payload) };
  }

  private write(
    subject: McpComponentHealthSubject,
    value: Omit<McpComponentHealthRecord, "subject" | "revision" | "recordDigest">
  ) {
    const key = subjectKey(subject);
    const base = {
      subject: structuredClone(subject),
      revision: (this.records.get(key)?.revision ?? 0) + 1,
      ...value,
    };
    const record: McpComponentHealthRecord = {
      ...base,
      recordDigest: digestCanonical(base),
    };
    this.records.set(key, record);
    return structuredClone(record);
  }
}

export function subjectKey(subject: McpComponentHealthSubject) {
  return digestCanonical(subject);
}

export function projectManualMcpServerViews(
  servers: readonly ManualMcpServerView[],
  records: readonly McpComponentHealthRecord[]
): ManualMcpServerView[] {
  return servers.map((server) => ({
    ...server,
    health: aggregateHealth(records.filter((record) =>
      record.subject.kind === "manual" &&
      record.subject.serverId === server.serverId &&
      sameScope(record.subject.scope, server.owner) &&
      record.subject.configDigest === server.configDigest &&
      record.subject.transport === server.transport
    )),
  }));
}

function sameScope(
  left: ManualMcpServerView["owner"],
  right: ManualMcpServerView["owner"]
) {
  return left.kind === right.kind &&
    (left.kind === "global" ||
      (right.kind === "project" && left.projectId === right.projectId));
}

function aggregateHealth(
  records: readonly McpComponentHealthRecord[]
): McpServerHealthView {
  const state = records.some((record) => record.state === "quarantined")
    ? "quarantined" as const
    : records.some((record) => record.state === "degraded")
      ? "degraded" as const
      : records.some((record) => record.state === "healthy")
        ? "healthy" as const
        : "unobserved" as const;
  return {
    state,
    revision: Math.max(0, ...records.map((record) => record.revision)),
    detail: records.length
      ? `${records.length} 个 backend/runtime 观察记录`
      : "尚无协议层成功或失败证据",
  };
}
