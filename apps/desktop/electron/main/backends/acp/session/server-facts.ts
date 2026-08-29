/**
 * [INPUT]: Depends on ACP session configOptions and a runtime identity binding supplied by the composition root
 * [OUTPUT]: Provides NegotiatedServerFactsOracle with order-independent session binding (bindSession), pre-prompt completeness, duplicate/ambiguity rejection, frozen drift detection and strict receipt validation
 * [POS]: The ACP server-fact oracle; the receipt carries negotiated model/mode evidence only — product permission policy is structurally absent from it
 */

import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type { SessionConfigState } from "./config";

/* ============================================================
 * 协商事实的准入判据只有一条：**来自 session/new|load response 的同步宣告**
 * ——一次、必达、确定，才配当 pre-prompt gate 的证据。
 *
 * command 曾是第三个 kind，2026-08-28 整体退出：available_commands_update
 * 在 ACP 里是**状态广播**——fire-and-forget、无时序保证、随 MCP/CLI 就绪
 * 多次推送且值会演进（claude-agent-acp 0.70.0 真机：newSession 后推一版，
 * MCP 连上后再推一版）。把广播当握手，同一原罪炸出四种死法：早到
 * MISMATCH、两次异值 DRIFT、两次同值 DUPLICATE、晚到 MISSING。receipt
 * 零消费方、命令表数据零产品消费——它从来就不是协商事实，删。
 * ============================================================ */
const REQUIRED_FACT_KINDS = ["model", "mode"] as const;
type ServerFactKind = (typeof REQUIRED_FACT_KINDS)[number];

export type ServerFactBinding = Readonly<{
  runtimeGeneration: number;
  executableIdentity: string;
}>;

/* 只作 receipt 的构件，模块外无人具名——不导出，公开面就少一格可漂移的形状。 */
type NegotiatedServerFact = Readonly<{
  kind: ServerFactKind;
  id: string;
  values: readonly string[];
}>;

export type NegotiatedServerFactsReceipt = Readonly<{
  schemaVersion: 1;
  sessionId: string;
  runtimeGeneration: number;
  executableIdentity: string;
  facts: readonly NegotiatedServerFact[];
}>;

type SelectConfig = Extract<SessionConfigOption, { type: "select" }>;

export class NegotiatedServerFactsOracle {
  private sessionId?: string;
  private readonly facts = new Map<ServerFactKind, NegotiatedServerFact>();
  private receipt: NegotiatedServerFactsReceipt | null = null;

  constructor(private readonly binding: ServerFactBinding) {
    assertBinding(binding);
  }

  /* 会话身份在 session/new response 到达那一刻就成立；配置事实要等协商完成。
     两个时刻，两个方法。bind 幂等：同 id 重复无害，异 id 才是串号。 */
  bindSession(sessionId: string) {
    if (!sessionId.trim()) throw new Error("SERVER_FACTS_UNKNOWN_SESSION");
    if (this.sessionId && this.sessionId !== sessionId) {
      throw new Error("SERVER_FACTS_SESSION_REBIND");
    }
    this.sessionId = sessionId;
  }

  observeSession(sessionId: string, state: SessionConfigState) {
    this.bindSession(sessionId);
    for (const option of state.configOptions ?? []) {
      if (option.type !== "select") continue;
      if (option.category === "model" || option.id === "model") {
        this.write(selectFact("model", option));
      }
      if (option.category === "mode" || option.id === "mode") {
        this.write(selectFact("mode", option));
      }
    }
    this.freezeIfComplete();
  }

  private write(fact: NegotiatedServerFact) {
    const next = freezeFact(fact);
    const current = this.facts.get(fact.kind);
    if (current) {
      if (sameFact(current, next)) {
        throw new Error(`SERVER_FACTS_DUPLICATE_${fact.kind.toUpperCase()}`);
      }
      throw new Error(`SERVER_FACTS_${fact.kind.toUpperCase()}_DRIFT`);
    }
    this.facts.set(fact.kind, next);
  }

  /* 最小集合一齐全就地冻结并校验：非法 receipt 要在观察点炸，而不是拖到
     prompt admission 才炸——那时错误已经隔了几层调用栈。 */
  private freezeIfComplete() {
    if (this.receipt || !this.sessionId) return;
    if (!REQUIRED_FACT_KINDS.every((kind) => this.facts.has(kind))) return;
    this.assertComplete();
  }

  assertComplete() {
    if (!this.sessionId) throw new Error("SERVER_FACTS_UNKNOWN_SESSION");
    for (const kind of REQUIRED_FACT_KINDS) {
      if (!this.facts.has(kind)) {
        throw new Error(`SERVER_FACTS_MISSING_${kind.toUpperCase()}`);
      }
    }
    if (this.receipt) return this.receipt;
    const receipt = validateNegotiatedServerFactsReceipt({
      schemaVersion: 1,
      sessionId: this.sessionId,
      ...this.binding,
      facts: REQUIRED_FACT_KINDS.map((kind) => this.facts.get(kind)!),
    });
    this.receipt = receipt;
    return receipt;
  }
}

export function validateNegotiatedServerFactsReceipt(
  value: NegotiatedServerFactsReceipt,
  expected?: Readonly<{ sessionId: string } & ServerFactBinding>
) {
  assertBinding(value);
  if (!value.sessionId.trim()) throw new Error("SERVER_FACTS_UNKNOWN_SESSION");
  if (value.schemaVersion !== 1) throw new Error("SERVER_FACTS_UNKNOWN_SCHEMA");
  if (expected) {
    if (value.sessionId !== expected.sessionId) {
      throw new Error("SERVER_FACTS_SESSION_MISMATCH");
    }
    if (value.runtimeGeneration !== expected.runtimeGeneration) {
      throw new Error("SERVER_FACTS_RUNTIME_GENERATION_MISMATCH");
    }
    if (value.executableIdentity !== expected.executableIdentity) {
      throw new Error("SERVER_FACTS_EXECUTABLE_IDENTITY_MISMATCH");
    }
  }
  if (
    !Array.isArray(value.facts) ||
    value.facts.length !== REQUIRED_FACT_KINDS.length
  ) {
    throw new Error("SERVER_FACTS_UNKNOWN_OR_DUPLICATE_KIND");
  }
  const receiptFacts = value.facts as readonly NegotiatedServerFact[];
  const facts = new Map<ServerFactKind, NegotiatedServerFact>(
    receiptFacts.map((fact) => [fact.kind, fact] as const)
  );
  if (facts.size !== receiptFacts.length) {
    throw new Error("SERVER_FACTS_UNKNOWN_OR_DUPLICATE_KIND");
  }
  for (const kind of REQUIRED_FACT_KINDS) {
    const fact = facts.get(kind);
    if (!fact || !fact.id.trim() || fact.values.length === 0) {
      throw new Error(`SERVER_FACTS_MISSING_${kind.toUpperCase()}`);
    }
    if (fact.values.some((entry) => !entry.trim())) {
      throw new Error(`SERVER_FACTS_UNKNOWN_${kind.toUpperCase()}_VALUE`);
    }
    if (new Set(fact.values).size !== fact.values.length) {
      throw new Error(`SERVER_FACTS_AMBIGUOUS_${kind.toUpperCase()}_VALUE`);
    }
  }
  return Object.freeze({
    ...value,
    facts: Object.freeze(value.facts.map(freezeFact)),
  });
}

function selectFact(kind: "model" | "mode", option: SelectConfig) {
  const values = option.options.flatMap((entry) =>
    "value" in entry
      ? [entry.value]
      : entry.options.map((nested) => nested.value)
  );
  if (!option.id.trim() || values.length === 0 || values.some((value) => !value.trim())) {
    throw new Error(`SERVER_FACTS_UNKNOWN_${kind.toUpperCase()}_VALUE`);
  }
  return { kind, id: option.id, values } as const;
}

function freezeFact(fact: NegotiatedServerFact): NegotiatedServerFact {
  return Object.freeze({ ...fact, values: Object.freeze([...fact.values]) });
}

function sameFact(left: NegotiatedServerFact, right: NegotiatedServerFact) {
  return (
    left.id === right.id &&
    left.values.length === right.values.length &&
    left.values.every((value, index) => value === right.values[index])
  );
}

function assertBinding(binding: ServerFactBinding) {
  if (!Number.isSafeInteger(binding.runtimeGeneration) || binding.runtimeGeneration < 0) {
    throw new Error("SERVER_FACTS_UNKNOWN_RUNTIME_GENERATION");
  }
  if (!binding.executableIdentity.trim()) {
    throw new Error("SERVER_FACTS_UNKNOWN_EXECUTABLE_IDENTITY");
  }
}
