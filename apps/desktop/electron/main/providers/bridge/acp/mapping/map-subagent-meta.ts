/**
 * [INPUT]: Depends on ACP session-update `_meta` payloads from Codex/Claude and the caller's session-id validator
 * [OUTPUT]: Provides AcpSubagentMeta plus mapAcpSubagentMeta, the single source of subagent attribution for ACP updates
 * [POS]: Pure sibling of map-events.ts; the two are independent translation units and neither holds session state
 */
export type AcpSubagentMeta = {
  threadId: string;
  /** path 末段；缺席时由调用方回退到 threadId 前缀命名 */
  name?: string;
  status: "running" | "interrupted";
};

type CodexSubagentMeta = Readonly<{
  threadId?: unknown;
  path?: unknown;
  activity?: unknown;
}>;

/**
 * Codex emits a real child thread identity; Claude exposes only the parent
 * Task tool-use id. The latter is deliberately tool-attribution only: Claude
 * child text/thinking is filtered by the adapter and must not be implied here.
 */
export function mapAcpSubagentMeta(
  update: unknown,
  validateSessionId: (id: string) => boolean
): AcpSubagentMeta | undefined {
  const root = (
    update as {
      _meta?: {
        codex?: { subagent?: CodexSubagentMeta };
        claudeCode?: { parentToolUseId?: unknown };
      };
    } | null
  )?._meta;
  /* 两源互不耦合：codex 先问只因它的语义更全（真子线程），而不是 claude
     那支挂在它的失败分支上。摘掉任一支，另一支必须原样成立。 */
  return (
    codexSubagentMeta(root?.codex?.subagent, validateSessionId) ??
    claudeSubagentMeta(root?.claudeCode?.parentToolUseId)
  );
}

/** Codex 下发真实子线程身份：名字、活动态都由它自己说了算。 */
function codexSubagentMeta(
  meta: CodexSubagentMeta | undefined,
  validateSessionId: (id: string) => boolean
): AcpSubagentMeta | undefined {
  if (typeof meta?.threadId !== "string" || !validateSessionId(meta.threadId)) {
    return undefined;
  }
  const path =
    typeof meta.path === "string"
      ? meta.path.split("/").filter(Boolean)
      : Array.isArray(meta.path)
        ? meta.path.filter(
            (entry): entry is string => typeof entry === "string"
          )
        : [];
  return {
    threadId: meta.threadId,
    ...(path.at(-1) ? { name: path.at(-1) } : {}),
    status: meta.activity === "interrupted" ? "interrupted" : "running",
  };
}

/**
 * Claude 只给父 Task 的 tool-use id——那是**归属**，不是子线程。子 agent 的
 * text/thinking 被 adapter 过滤后压根不上 wire，所以这里能诚实说的只有
 * 「这些工具调用同属一次 Task」；UI 不得据此暗示与 Codex 同级。
 */
function claudeSubagentMeta(
  parentToolUseId: unknown
): AcpSubagentMeta | undefined {
  if (
    typeof parentToolUseId !== "string" ||
    Buffer.byteLength(parentToolUseId, "utf8") > 128 ||
    !/^[^\p{Cc}\p{Cf}]+$/u.test(parentToolUseId)
  ) {
    return undefined;
  }
  return {
    threadId: parentToolUseId,
    name: "Claude subagent tools",
    status: "running",
  };
}
