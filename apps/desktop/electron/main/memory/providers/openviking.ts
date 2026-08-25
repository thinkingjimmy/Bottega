/**
 * [INPUT]: Depends on the loopback of wire.ts JSON client with the assertor, memory provider port agreement, standardized baseUrl
 * [OUTPUT]: Provides OpenVikingProvider: Private combination /health+/ready, independent expression of runtime readiness with data aspect auth, strict recall wire, peer-only data aspect, task three methods with workspace purge
 * [POS]: async-task provider of main/memory; Only parse OpenViking wire and fail to unify to MemoryProviderError
 */

import {
  MemoryProviderError,
  PROVIDER_SNIPPET_CHAR_CAP,
  normalizeMemoryBaseUrl,
  type CommitReceipt,
  type CommitTaskStatus,
  type MemoryHealthProbe,
  type MemoryProvider,
  type MemoryRecallResult,
  type ProviderCall,
  type ProviderSessionRef,
} from "../core/provider";
import {
  LoopbackJsonClient,
  integer,
  literal,
  object,
  text,
  type JsonObject,
} from "./wire";

const BATCH_LIMIT = 100;
const POLICY = {
  self: { enabled: false },
  peer: { enabled: true },
} as const;

function resultEnvelope(value: unknown, context: string) {
  const envelope = object(value, context);
  if (envelope.status !== "ok") {
    const error =
      envelope.error && typeof envelope.error === "object"
        ? JSON.stringify(envelope.error)
        : "status != ok";
    throw new MemoryProviderError("http", `${context} 返回错误：${error}`);
  }
  return envelope.result;
}

function policyMatches(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const policy = value as JsonObject;
  return (
    Object.keys(policy).length === 2 &&
    JSON.stringify(policy.self) === JSON.stringify(POLICY.self) &&
    JSON.stringify(policy.peer) === JSON.stringify(POLICY.peer)
  );
}

const sessionPath = (ref: ProviderSessionRef) =>
  `/api/v1/sessions/${encodeURIComponent(ref.remoteSessionId)}`;

const actorHeaders = (workspacePeerId: string) => ({
  "X-OpenViking-Actor-Peer": workspacePeerId,
});

export class OpenVikingProvider implements MemoryProvider {
  readonly id = "openviking";
  readonly baseUrl: string;
  private readonly client: LoopbackJsonClient;

  constructor(baseUrl: string, fetcher: typeof fetch = fetch) {
    this.baseUrl = normalizeMemoryBaseUrl(baseUrl);
    this.client = new LoopbackJsonClient(this.baseUrl, "OpenViking", fetcher);
  }

  /* ============================================================
   * 握手按病因分层：连不上 / 未就绪 / 认证不匹配是硬失败，
   * 版本漂移只降级为 compat——下游每个调用都自校验 wire 形状，
   * 未验证版本最坏也只是 typed 失败 + fail-open。
   * ============================================================ */
  async health(input: ProviderCall = {}): Promise<MemoryHealthProbe> {
    let health: JsonObject;
    try {
      health = object(
        await this.client.request("/health", {
          timeoutMs: 2_000,
          signal: input.signal,
        }),
        "OpenViking /health"
      );
    } catch (cause) {
      return this.probeFailure(cause);
    }
    const version = typeof health.version === "string" ? health.version : undefined;
    if (health.healthy !== true) {
      return {
        status: "unavailable",
        issue: {
          kind: "unhealthy",
          detail: `healthy=${JSON.stringify(health.healthy ?? null)}`,
        },
        ...(version ? { version } : {}),
      };
    }
    const authIssue = health.auth_mode === "dev"
      ? null
      : { kind: "auth" as const, detail: String(health.auth_mode ?? "unknown") };
    let runtimeReady = true;
    let readinessFailure: MemoryHealthProbe | null = null;
    try {
      await this.client.request("/ready", {
        timeoutMs: 2_000,
        signal: input.signal,
      });
    } catch (cause) {
      runtimeReady = false;
      readinessFailure = this.probeFailure(cause);
    }
    if (authIssue) {
      return {
        status: "unavailable",
        issue: authIssue,
        ...(version ? { version } : {}),
        runtimeHealthy: true,
        runtimeReady,
      };
    }
    if (readinessFailure) {
      return {
        ...readinessFailure,
        ...(version ? { version } : {}),
        runtimeHealthy: true,
        runtimeReady: false,
      };
    }
    return {
      status: "ready",
      ...(version ? { version } : {}),
      runtimeHealthy: true,
      runtimeReady: true,
    };
  }

  private probeFailure(cause: unknown): MemoryHealthProbe {
    if (!(cause instanceof MemoryProviderError)) throw cause;
    const kind =
      cause.kind === "network" || cause.kind === "timeout"
        ? "unreachable"
        : cause.kind === "protocol"
          ? "protocol"
          : "unhealthy";
    const detail = kind === "unreachable"
      ? "服务暂时不可达"
      : kind === "protocol"
        ? "服务响应格式无效"
        : "服务健康检查未通过";
    return { status: "unavailable", issue: { kind, detail } };
  }

  async ensureSession(ref: ProviderSessionRef, input: ProviderCall = {}) {
    try {
      await this.client.request("/api/v1/sessions", {
        method: "POST",
        body: {
          session_id: ref.remoteSessionId,
          memory_policy: POLICY,
        },
        timeoutMs: 5_000,
        signal: input.signal,
        acceptedStatuses: [409],
      });
    } catch (cause) {
      if (!(cause instanceof MemoryProviderError)) throw cause;
      if (!["network", "timeout", "http"].includes(cause.kind)) throw cause;
    }
    const meta = object(
      resultEnvelope(
        await this.client.request(sessionPath(ref), {
          timeoutMs: 5_000,
          signal: input.signal,
        }),
        "OpenViking session GET"
      ),
      "OpenViking session"
    );
    if (!policyMatches(meta.memory_policy)) {
      throw new MemoryProviderError(
        "protocol",
        "OpenViking session memory_policy 不是 canonical peer-only"
      );
    }
  }

  async disposeSessionRaw(ref: ProviderSessionRef, input: ProviderCall = {}) {
    try {
      const value = await this.client.request(sessionPath(ref), {
        method: "DELETE",
        timeoutMs: 15_000,
        signal: input.signal,
        acceptedStatuses: [404],
      });
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        (value as JsonObject).status === "error"
      ) {
        const error = (value as JsonObject).error;
        if (
          !error ||
          typeof error !== "object" ||
          (error as JsonObject).code !== "NOT_FOUND"
        ) {
          resultEnvelope(value, "OpenViking dispose session");
        }
      }
    } catch (cause) {
      if (
        cause instanceof MemoryProviderError &&
        cause.kind === "http" &&
        cause.message.includes("404")
      ) {
        return;
      }
      throw cause;
    }
  }

  /* ============================================================
   * workspace purge（0.4.11 源码核实，routers/filesystem.py）：
   * 路由是 DELETE /api/v1/fs（无 /nodes），参数名是 uri 而非 path。
   * 目标取 user-relative 的 peers 子树——产品写入的记忆全部归于
   * viking://user/peers/<peer>（recall 过滤器认的正是这棵子树）。
   *
   * wait 默认 false：不显式要求同步完成，rebuild 就会在「删除还在
   * 后台跑」的时刻开始回灌，新旧记忆混在一起。这里硬要 wait=true
   * 并给足超时（N1 的兜底是超时后挂 needs-attention，而不是假装
   * 删干净了）。404 = 全新 workspace 本就无物可删。
   * ============================================================ */
  async purgeWorkspace(input: ProviderCall & { workspacePeerId: string }) {
    const query = new URLSearchParams({
      uri: `viking://user/peers/${input.workspacePeerId}`,
      recursive: "true",
      wait: "true",
      timeout: "110",
    });
    await this.client.request(`/api/v1/fs?${query}`, {
      method: "DELETE",
      headers: actorHeaders(input.workspacePeerId),
      timeoutMs: 120_000,
      signal: input.signal,
      acceptedStatuses: [404],
    });
  }

  async getSessionMeta(ref: ProviderSessionRef, input: ProviderCall = {}) {
    const result = object(
      resultEnvelope(
        await this.client.request(sessionPath(ref), {
          timeoutMs: 5_000,
          signal: input.signal,
        }),
        "OpenViking session meta"
      ),
      "OpenViking session meta"
    );
    return {
      commitCount: integer(
        result.commit_count,
        "OpenViking session meta.commit_count"
      ),
    };
  }

  async listCommitTasks(ref: ProviderSessionRef, input: ProviderCall = {}) {
    const query = new URLSearchParams({
      task_type: "session_commit",
      resource_id: ref.remoteSessionId,
      limit: "200",
    });
    const result = resultEnvelope(
      await this.client.request(`/api/v1/tasks?${query}`, {
        timeoutMs: 5_000,
        signal: input.signal,
      }),
      "OpenViking task list"
    );
    if (!Array.isArray(result)) {
      throw new MemoryProviderError("protocol", "OpenViking task list 不是数组");
    }
    return result.map((item, index) => ({
      taskId: text(
        object(item, `OpenViking task ${index}`).task_id,
        `OpenViking task ${index}.task_id`
      ),
    }));
  }

  async recall(
    input: ProviderCall & {
      query: string;
      workspacePeerId: string;
      snippetCharCap: number;
    }
  ): Promise<MemoryRecallResult> {
    const result = object(
      resultEnvelope(
        await this.client.request("/api/v1/search/recall", {
          method: "POST",
          headers: actorHeaders(input.workspacePeerId),
          body: {
            query: input.query,
            max_chars: Math.max(1, Math.min(PROVIDER_SNIPPET_CHAR_CAP, input.snippetCharCap)),
            peer_scope: "actor",
            render: false,
          },
          timeoutMs: 1_500,
          signal: input.signal,
        }),
        "OpenViking recall"
      ),
      "OpenViking recall result"
    );
    if (!Array.isArray(result.entries)) {
      throw new MemoryProviderError(
        "protocol",
        "OpenViking recall entries 不是数组"
      );
    }
    const candidates = result.entries.flatMap((raw, index) => {
      const entry = object(raw, `OpenViking recall entry ${index}`);
      const recalled =
        typeof entry.content === "string" && entry.content
          ? entry.content
          : typeof entry.summary === "string" && entry.summary
            ? entry.summary
            : typeof entry.abstract === "string"
              ? entry.abstract
              : "";
      if (!recalled) return [];
      return [
        {
          text: recalled,
          ...(typeof entry.score === "number" ? { score: entry.score } : {}),
          sourceRef:
            typeof entry.uri === "string" ? entry.uri : `entry:${index}`,
          ownership: {
            kind: "openviking" as const,
            peerId:
              typeof entry.peer_id === "string" ? entry.peer_id : null,
            uri: typeof entry.uri === "string" ? entry.uri : null,
            origin: typeof entry.origin === "string" ? entry.origin : null,
          },
        },
      ];
    });
    return { candidates };
  }

  /* batch ≤100 是服务端硬上限；回灌一整个 chat 必然越线，
     分片在 adapter 内完成，Delivery Owner 只管一批的语义边界。
     created_at 必须补发：不发它，服务端按收到时刻排序，
     回灌的历史会全部堆在「现在」，时间线彻底失真。 */
  async capture(
    ref: ProviderSessionRef,
    input: ProviderCall & {
      messages: Array<{
        role: "user" | "assistant";
        content: string;
        createdAt: number;
      }>;
    }
  ) {
    for (let index = 0; index < input.messages.length; index += BATCH_LIMIT) {
      await this.client.request(`${sessionPath(ref)}/messages/batch`, {
        method: "POST",
        body: {
          messages: input.messages
            .slice(index, index + BATCH_LIMIT)
            .map((message) => ({
              role: message.role,
              content: message.content,
              peer_id: ref.workspacePeerId,
              created_at: new Date(message.createdAt).toISOString(),
            })),
        },
        timeoutMs: 15_000,
        signal: input.signal,
      });
    }
  }

  async commit(
    ref: ProviderSessionRef,
    input: ProviderCall = {}
  ): Promise<CommitReceipt> {
    const result = object(
      resultEnvelope(
        await this.client.request(`${sessionPath(ref)}/commit`, {
          method: "POST",
          headers: actorHeaders(ref.workspacePeerId),
          body: {},
          timeoutMs: 5_000,
          signal: input.signal,
        }),
        "OpenViking commit"
      ),
      "OpenViking commit result"
    );
    /* skipped 原样上抛：它是 no_messages / all_within_keep_window 的
       真实语义，压成 completed 就等于谎报「已提取」。 */
    if (result.status === "skipped") {
      return {
        status: "skipped",
        reason:
          typeof result.reason === "string" ? result.reason : "provider skipped",
      };
    }
    return {
      status: "accepted",
      taskId: text(result.task_id, "OpenViking commit.task_id"),
    };
  }

  async getCommitStatus(
    input: ProviderCall & { taskId: string }
  ): Promise<CommitTaskStatus> {
    const result = object(
      resultEnvelope(
        await this.client.request(
          `/api/v1/tasks/${encodeURIComponent(input.taskId)}`,
          { timeoutMs: 5_000, signal: input.signal }
        ),
        "OpenViking task status"
      ),
      "OpenViking task status"
    );
    return literal(
      result.status,
      ["pending", "running", "completed", "failed"] as const,
      "OpenViking task.status"
    );
  }
}
