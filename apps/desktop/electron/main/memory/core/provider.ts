/**
 * [INPUT]: Depends on shared/memory-ipc's descriptor/health/ResolvedConfigValues Agreement with AbortSignal
 * [OUTPUT]: Provides owner-aware RecallResult, ProviderSessionRef, Provider Private Runtime Readiness Evidence, MemoryHealthProbe, typed error, InstallSpec, configuration values are aligned with the MemoryProviderModule shape
 * [POS]: The main/memory/core hot-out contract; Turn pipeline and service layer don't know any specific endpoints
 */

import type {
  MemoryConfigPanel,
  MemoryHealthIssue,
  MemoryProviderDescriptor,
  ResolvedConfigValues,
} from "../../../../shared/memory-ipc";

export type MemoryRecallCandidate = {
  text: string;
  score?: number;
  sourceRef: string;
  ownership:
    | {
        kind: "everos";
        userId: string | null;
        appId: string | null;
        projectId: string | null;
      }
    | {
        kind: "openviking";
        /** 0.4.11 recall 实际不返回 peer_id；canonical URI 才是必备 owner 证据。 */
        peerId: string | null;
        uri: string | null;
        origin: string | null;
      };
};

export type MemoryRecallResult = {
  candidates: MemoryRecallCandidate[];
};

/** 旧渲染 helper 的输入别名；生产 ownership gate 只接 RecallResult。 */
export type MemorySnippet = MemoryRecallCandidate;

/** provider 侧选材字符上限的唯一真值；两家 adapter 都以它为 clamp 天花板。 */
export const PROVIDER_SNIPPET_CHAR_CAP = 2_000;

/* ============================================================
 * ProviderSessionRef：远端寻址的唯一形状（D11）。
 * adapter 永远不许自己从 sessionKey 派生 remote id——三处派生
 * 就是三种命名法，切后端时对不上号的孤儿 session 由此而生。
 * ============================================================ */
export type ProviderSessionRef = Readonly<{
  sessionKey: string;
  workspacePeerId: string;
  remoteSessionId: string;
}>;

/* completed 与 accepted 是两种终局：前者已落地，后者交给任务对账。
   没有 unknown 变体——两家 adapter 都不产它，留一个没人写的分支，
   只会让「G1 覆盖了 unknown」这句话变成只覆盖了类型。真正的不确定
   由相位机的崩溃恢复处理，而不是由 provider 自称。 */
export type CommitReceipt =
  | { status: "completed" }
  | { status: "accepted"; taskId: string }
  | { status: "skipped"; reason: string };

export type CommitTaskStatus = "pending" | "running" | "completed" | "failed";

export type MemoryProviderErrorKind =
  | "network"
  | "timeout"
  | "http"
  | "protocol";

export class MemoryProviderError extends Error {
  constructor(
    readonly kind: MemoryProviderErrorKind,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "MemoryProviderError";
  }
}

/** 探针不折叠病因：ready 无附注；compat/unavailable 必须交代 issue。 */
export type MemoryHealthProbe =
  | {
      status: "ready";
      version?: string;
      capabilities?: string[];
      runtimeHealthy?: boolean;
      runtimeReady?: boolean;
    }
  | {
      status: "compat" | "unavailable";
      issue: MemoryHealthIssue;
      version?: string;
      capabilities?: string[];
      /** 协议私有的“服务活着但仍未 ready”只能由 adapter 提供。 */
      runtimeHealthy?: boolean;
      runtimeReady?: boolean;
    };

export type ProviderCall = { signal?: AbortSignal };

export interface MemoryProvider {
  readonly id: string;
  readonly baseUrl: string;
  health(input?: ProviderCall): Promise<MemoryHealthProbe>;
  recall(
    input: ProviderCall & {
      query: string;
      workspacePeerId: string;
      /** provider 侧选材字符上限；与 prompt lane 的 8KiB UTF-8 渲染预算无关。 */
      snippetCharCap: number;
    }
  ): Promise<MemoryRecallResult>;

  /* ── session 方法一律收 ProviderSessionRef ── */
  ensureSession(ref: ProviderSessionRef, input?: ProviderCall): Promise<void>;
  capture(
    ref: ProviderSessionRef,
    input: ProviderCall & {
      /** v3 总是提供；provider 支持幂等时应作为去重键消费。 */
      payloadId?: string;
      /** 对应本地 turn request；用于远端审计，不得替代 payloadId。 */
      turnId?: string;
      messages: Array<{
        role: "user" | "assistant";
        content: string;
        createdAt: number;
      }>;
    }
  ): Promise<void>;
  commit(
    ref: ProviderSessionRef,
    input?: ProviderCall
  ): Promise<CommitReceipt>;
  /** raw：不带 tombstone 语义的尽力删除，只被 rebuild 的 purge 阶段使用。 */
  disposeSessionRaw(
    ref: ProviderSessionRef,
    input?: ProviderCall
  ): Promise<void>;

  /* ── 能力方法按 descriptor 分档，缺席即该型不适用 ──
     commitModel==="async-task" 必须实现下面三个（baseline 与对账靠它们）；
     sync 型没有 task 概念，不写仪式性 stub——契约上多一行没人调用的
     方法，只会让「G1 覆盖了它」变成只覆盖了类型。 */
  getSessionMeta?(
    ref: ProviderSessionRef,
    input?: ProviderCall
  ): Promise<{ commitCount: number }>;
  listCommitTasks?(
    ref: ProviderSessionRef,
    input?: ProviderCall
  ): Promise<{ taskId: string }[]>;
  getCommitStatus?(
    input: ProviderCall & { taskId: string }
  ): Promise<CommitTaskStatus>;
  /** purgeModel==="workspace-purge" 才实现；runtime-reset 型由 Coordinator 清根。 */
  purgeWorkspace?(
    input: ProviderCall & { workspacePeerId: string }
  ): Promise<void>;
}

/** async-task 三方法的存在性断言：分支只在 batch-worker 判一次。 */
export function requireTaskPort(provider: MemoryProvider) {
  const { getSessionMeta, listCommitTasks, getCommitStatus } = provider;
  if (!getSessionMeta || !listCommitTasks || !getCommitStatus) {
    throw new MemoryProviderError(
      "protocol",
      `${provider.id} 未实现 async-task 能力方法；descriptor.commitModel 与 adapter 不一致`
    );
  }
  return {
    getSessionMeta: getSessionMeta.bind(provider),
    listCommitTasks: listCommitTasks.bind(provider),
    getCommitStatus: getCommitStatus.bind(provider),
  };
}

/* ============================================================
 * 可插拔运行时的安装规格：版本永远锁定（D15），下载 → SHA256
 * 校验 → 从已验证文件安装。installRoot 永不 purge，dataRoot 才是
 * 唯一可 reset 的根（D12）。
 * ============================================================ */
export type InstallArtifact = {
  /** PyPI sdist/wheel 直链；空表示走索引解析。 */
  url: string;
  filename: string;
  sha256: string;
};

export type ModelAsset = {
  url: string;
  filename: string;
  bytes: number;
  sha256: string;
};

export type InstallSpec = {
  providerId: string;
  launchLabel: string;
  lockedVersion: string;
  pythonVersion: string;
  /** venv 内可执行文件名（相对 installRoot/venv/bin）。 */
  executable: string;
  /** 主命令完整参数；路径一律使用 {{dataRoot}} 占位符。 */
  serveArgs: string[];
  initMode: "builder" | "argv";
  /** argv 模式的完整 init 参数；builder 模式不执行上游 init。 */
  initArgs?: string[];
  /** 期望 init 产出的配置文件（相对 dataRoot），缺一从模板补齐。 */
  configFiles: string[];
  artifacts: InstallArtifact[];
  /** 产品直接复验与预取的模型字节；与 provider 包版本解耦。 */
  modelAssets?: ModelAsset[];
  /** 仅声明具备可信版本目录的主包；伴随锁仍由 pinnedPackages 持有。 */
  pypiPackage?: string;
  /** 额外锁版依赖（无独立 SHA 校验需求的协议包）。 */
  pinnedPackages: string[];
  /** 进程静态环境；不含任何密钥。 */
  staticEnv: Record<string, string>;
  configBuilders?: Record<
    string,
    (context: {
      dataRoot: string;
      installRoot: string;
      values: ResolvedConfigValues;
    }) => object
  >;
  /** 手工接管时从 Provider 实际读取的配置路径；不可靠解析就拒绝接管。 */
  extractionDestination?: {
    file: string;
    baseUrlPath: string[];
    modelPath: string[];
  };
};

export type MemoryProviderModule = {
  descriptor: MemoryProviderDescriptor;
  createProvider(input: { baseUrl: string }): MemoryProvider;
  installSpec?: InstallSpec;
  configPanel?: MemoryConfigPanel;
};

export function resolveConfigValues(
  panel: MemoryConfigPanel | undefined,
  stored: Record<string, string>,
  submitted?: Record<string, string>
) {
  const values: ResolvedConfigValues = {};
  const missingRequired: string[] = [];
  for (const field of panel?.fields ?? []) {
    const submittedValue = submitted?.[field.key]?.trim() ?? "";
    const fallback = field.defaultValue ?? "";
    const value =
      submitted === undefined
        ? stored[field.key] || fallback
        : submittedValue ||
          (field.retainedWhenBlank ? stored[field.key] || fallback : fallback);
    values[field.key] = value;
    if (field.required && !value) missingRequired.push(field.key);
  }
  return { values, missingRequired };
}

export function renderRuntimeArgs(args: string[], dataRoot: string) {
  return args.map((arg) => arg.replaceAll("{{dataRoot}}", dataRoot));
}

/* ============================================================
 * 提取模型 Base URL 的字段级校验。它决定「密钥与对话正文发去哪」，
 * 因此不能是自由文本：外部服务必须走 HTTPS（明文 http 只允许本机），
 * 且不得内嵌凭证。与 normalizeMemoryBaseUrl（管的是本机记忆服务地址、
 * 禁路径）不同——OpenAI 兼容 base url 合法地带 `/v1` 路径，故这里
 * 只锁 scheme/host/凭证，放行路径。
 * ============================================================ */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);

export function assertModelBaseUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("提取模型 Base URL 无效");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("提取模型 Base URL 仅支持 http/https");
  }
  if (url.username || url.password) {
    throw new Error("提取模型 Base URL 不能内嵌凭证");
  }
  if (
    url.protocol === "http:" &&
    !LOOPBACK_HOSTS.has(url.hostname.toLowerCase())
  ) {
    throw new Error("http 的 Base URL 只允许指向本机；外部服务请使用 https");
  }
}

export function normalizeMemoryBaseUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Memory 本机目标无效");
  }
  if (url.protocol !== "http:") {
    throw new Error("Memory 本机目标仅允许 HTTP");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Memory 本机目标不能包含凭证、查询参数或片段");
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error("Memory 本机目标不能包含路径");
  }
  const host = url.hostname.toLowerCase();
  if (host === "localhost") url.hostname = "127.0.0.1";
  if (!["127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase())) {
    throw new Error("Memory 本机目标仅允许 127.0.0.1 或 ::1");
  }
  if (!url.port) throw new Error("Memory 本机目标必须显式包含端口");
  url.pathname = "";
  return url.href.replace(/\/$/, "");
}
