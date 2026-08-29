/**
 * [INPUT]: Depends on the loopback of wire.ts JSON client with strict enumeration statements, MemoryProvider port agreement, standardised baseUrl
 * [OUTPUT]: Provides EverOSProvider: sync commitModel v2 add/flush strictly listing mapping, SuccessEnvelope/health schema testing, sender_id attribution keys, keyword retrieval and health probes; Failure to perform task
 * [POS]: The sync provider of main/memory; No task concepts, no workspace purge, Runtime reset to Managed Runtime
 */

import {
  MemoryProviderError,
  PROVIDER_SNIPPET_CHAR_CAP,
  normalizeMemoryBaseUrl,
  type CommitReceipt,
  type MemoryHealthProbe,
  type MemoryProvider,
  type MemoryRecallResult,
  type ProviderCall,
  type ProviderSessionRef,
} from "../core/provider";
import { LoopbackJsonClient, integer, literal, object, text } from "./wire";

/* ============================================================
 * wire 真值仅认 PyPI everos-1.2.1 sdist（SHA256 2ea75f30…）：
 *
 *   POST /api/v2/memory/add     {session_id, app_id, project_id,
 *                                messages:[{sender_id, role,
 *                                timestamp(epoch ms), content}]}
 *   POST /api/v2/memory/flush   {session_id, app_id, project_id}
 *   POST /api/v2/memory/search  {user_id XOR agent_id, app_id,
 *                                project_id, query, method, top_k}
 *   GET  /health                {status, version, capabilities{五布尔},
 *                                disabled_features[]}
 *
 * 成功响应一律 SuccessEnvelope：{request_id, data:{…}}，业务字段在
 * data 里。search 是 extra="forbid"：多发一个字段就是 422，枚举外
 * 的路径知识全部锚定在本文件，上层一行不改。
 * ============================================================ */
const VERSION = "1.2.1";
const APP_ID = "ai-chat-desktop";
const PROJECT_ID = "default";
const API_PREFIX = "/api/v2";
const HEALTH_CAPABILITIES = [
  "llm",
  "embed",
  "rerank",
  "multimodal_llm",
  "parser",
] as const;

/* 归属键单点：episode 按 role=user 消息的 sender_id 归 owner
   （extract/pipeline/user_memory.py 只取 user 角色的 sender），
   search 侧用 user_id 读同一归属。workspacePeerId 就是「同一个人」
   的边界——user 消息带 peer，assistant 消息带产品身份即可。 */
function writeScope(ref: ProviderSessionRef) {
  return {
    session_id: ref.remoteSessionId,
    app_id: APP_ID,
    project_id: PROJECT_ID,
  };
}

/** add 与 flush 的 wire 枚举（routes/memorize.py）——枚举外一律 protocol 错误。 */
const ADD_STATUS = ["accumulated", "extracted"] as const;
const FLUSH_STATUS = ["extracted", "no_extraction"] as const;

/** 200 包络：{request_id, data:{…}}，业务字段全部在 data 里。 */
function envelopeData(value: unknown, context: string) {
  const envelope = object(value, context);
  text(envelope.request_id, `${context}.request_id`);
  return object(envelope.data, `${context}.data`);
}

function healthPayload(value: unknown) {
  const health = object(value, "EverOS /health");
  const status = text(health.status, "EverOS /health.status");
  const version = text(health.version, "EverOS /health.version");
  const rawCapabilities = object(
    health.capabilities,
    "EverOS /health.capabilities"
  );
  const capabilities = HEALTH_CAPABILITIES.flatMap((name) => {
    const available = rawCapabilities[name];
    if (typeof available !== "boolean") {
      throw new MemoryProviderError(
        "protocol",
        `EverOS /health.capabilities.${name} 不是布尔值`
      );
    }
    return available ? [name] : [];
  });
  if (
    !Array.isArray(health.disabled_features) ||
    health.disabled_features.some((item) => typeof item !== "string")
  ) {
    throw new MemoryProviderError(
      "protocol",
      "EverOS /health.disabled_features 不是字符串数组"
    );
  }
  return { status, version, capabilities };
}

export class EverOSProvider implements MemoryProvider {
  readonly id = "everos";
  readonly baseUrl: string;
  private readonly client: LoopbackJsonClient;

  constructor(baseUrl: string, fetcher: typeof fetch = fetch) {
    this.baseUrl = normalizeMemoryBaseUrl(baseUrl);
    this.client = new LoopbackJsonClient(this.baseUrl, "EverOS", fetcher);
  }

  /* LLM 是 EverOS 的启动级硬依赖（lifespans/llm.py：密钥缺失时
     FastAPI 启不来）——因此「/health 可达且 status=ok」本身就证明
     提取可用；密钥未提交的中间态表现为连不上，由 Coordinator 的
     本地 secrets 检查负责判 configuration-required，不在 wire 上猜。 */
  async health(input: ProviderCall = {}): Promise<MemoryHealthProbe> {
    let health: ReturnType<typeof healthPayload>;
    try {
      health = healthPayload(
        await this.client.request("/health", {
          timeoutMs: 2_000,
          signal: input.signal,
        })
      );
    } catch (cause) {
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
    if (health.status !== "ok") {
      return {
        status: "unavailable",
        issue: {
          kind: "unhealthy",
          detail: `status=${JSON.stringify(health.status)}`,
        },
        version: health.version,
        capabilities: health.capabilities,
      };
    }
    if (health.version !== VERSION) {
      return {
        status: "compat",
        issue: { kind: "version", detail: health.version },
        version: health.version,
        capabilities: health.capabilities,
      };
    }
    return {
      status: "ready",
      version: health.version,
      capabilities: health.capabilities,
    };
  }

  /** EverOS 的 scope 是隐式的：没有建会话这一步，也就没有可失败的一步。 */
  async ensureSession(ref: ProviderSessionRef) {
    if (!ref.remoteSessionId || !ref.workspacePeerId) {
      throw new MemoryProviderError("protocol", "EverOS session ref 不完整");
    }
  }

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
    for (const [index, message] of input.messages.entries()) {
      if (!Number.isSafeInteger(message.createdAt) || message.createdAt <= 0) {
        throw new MemoryProviderError(
          "protocol",
          `EverOS message ${index}.createdAt 不是正 epoch 毫秒整数`
        );
      }
    }
    const result = envelopeData(
      await this.client.request(`${API_PREFIX}/memory/add`, {
        method: "POST",
        body: {
          ...writeScope(ref),
          messages: input.messages.map((message) => ({
            sender_id: message.role === "user" ? ref.workspacePeerId : APP_ID,
            role: message.role,
            /* v1 契约是 epoch 毫秒整数；发 ISO 字符串会直接 422。 */
            timestamp: message.createdAt,
            content: message.content,
          })),
        },
        timeoutMs: 30_000,
        signal: input.signal,
      }),
      "EverOS memory/add"
    );
    integer(result.message_count, "EverOS memory/add.message_count");
    literal(result.status, ADD_STATUS, "EverOS memory/add.status");
  }

  /* flush 是 sync commitModel 的终点：没有 taskId 可轮询，回包即终态。
     no_extraction 是「这批没什么可提取的」，与 extracted 同样是成功——
     两者都完成了本批的语义边界，水位理应前进。 */
  async commit(
    ref: ProviderSessionRef,
    input: ProviderCall = {}
  ): Promise<CommitReceipt> {
    const result = envelopeData(
      await this.client.request(`${API_PREFIX}/memory/flush`, {
        method: "POST",
        body: writeScope(ref),
        timeoutMs: 60_000,
        signal: input.signal,
      }),
      "EverOS memory/flush"
    );
    literal(result.status, FLUSH_STATUS, "EverOS memory/flush.status");
    return { status: "completed" };
  }

  /* method=keyword 是 Tier-1 能力：只要服务在跑（LLM 硬依赖已满足）
     它就可用。hybrid 需要 embedding 配置，当前配置面不提供——解锁
     记录在 DEV/memory/docs/deferred-boundaries.md。 */
  async recall(
    input: ProviderCall & {
      query: string;
      workspacePeerId: string;
      snippetCharCap: number;
    }
  ): Promise<MemoryRecallResult> {
    const result = envelopeData(
      await this.client.request(`${API_PREFIX}/memory/search`, {
        method: "POST",
        body: {
          user_id: input.workspacePeerId,
          app_id: APP_ID,
          project_id: PROJECT_ID,
          query: input.query,
          method: "keyword",
          top_k: 8,
        },
        timeoutMs: 2_000,
        signal: input.signal,
      }),
      "EverOS memory/search"
    );
    if (!Array.isArray(result.episodes)) {
      throw new MemoryProviderError(
        "protocol",
        "EverOS search episodes 不是数组"
      );
    }
    let budget = Math.max(1, Math.min(PROVIDER_SNIPPET_CHAR_CAP, input.snippetCharCap));
    const candidates = result.episodes.flatMap((raw, index) => {
      const episode = object(raw, `EverOS episode ${index}`);
      /* summary 是提取好的摘要，episode 是完整叙事——注入预算有限，
         摘要优先，缺摘要才退回叙事。 */
      const content =
        typeof episode.summary === "string" && episode.summary
          ? episode.summary
          : typeof episode.episode === "string"
            ? episode.episode
            : "";
      if (!content || content.length > budget) return [];
      budget -= content.length;
      return [
        {
          text: content,
          ...(typeof episode.score === "number" ? { score: episode.score } : {}),
          sourceRef:
            typeof episode.id === "string" ? episode.id : `episode:${index}`,
          ownership: {
            kind: "everos" as const,
            userId: typeof episode.user_id === "string" ? episode.user_id : null,
            appId: typeof episode.app_id === "string" ? episode.app_id : null,
            projectId:
              typeof episode.project_id === "string"
                ? episode.project_id
                : null,
          },
        },
      ];
    });
    return { candidates };
  }

  /** 1.2.1 没有任何删除记忆的端点；真正的清库是 Coordinator 的 runtime-reset。 */
  async disposeSessionRaw() {}
}
