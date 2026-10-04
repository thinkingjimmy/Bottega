/**
 * [INPUT]: Depends on Zod, the public RPC envelope/operation-name/strict-JSON contracts, VerifiedPrincipal and CapabilityRefTable
 * [OUTPUT]: Provides OperationRegistry (register a named, schema-bound, principal-scoped operation; dispatch one RPC request to a serialized response) and the OperationDefinition type
 * [POS]: The host side of "closures become capability refs + RPC": out-of-process callers name an operation and pass refs, never objects; the registry checks principal, refs and input before the handler runs and checks the result is plain JSON after
 */
import type { z } from "zod";
import { assertStrictJson, type JsonValue } from "@ai-chat/cloud-protocol/contracts/canonical";
import { operationNameSchema, rpcRequestSchema, RPC_VERSION, type CapabilityRefKind, type RpcResponse } from "@ai-chat/cloud-protocol/contracts/capabilities";
import type { PrincipalKind } from "@ai-chat/cloud-protocol/contracts/principals";
import { CapabilityRefError, type CapabilityRefTable } from "./capability-refs";
import { PrincipalRevokedError, type VerifiedPrincipal } from "./principals";
import { OperationBrokerError } from "./broker";

export type OperationContext = Readonly<{ principal: VerifiedPrincipal; refs: readonly unknown[]; signal: AbortSignal }>;

export type OperationDefinition<I> = Readonly<{
  name: string;
  input: z.ZodType<I>;
  principals: readonly PrincipalKind[];
  /** Ref kinds the caller must pass, in order; each resolves to the host-side target for this principal. */
  refs?: readonly CapabilityRefKind[];
  risk: "read" | "write";
  handler(context: OperationContext, input: I): Promise<JsonValue> | JsonValue;
}>;

type ErrorCode = Extract<RpcResponse, { ok: false }>["error"]["code"];
export class OperationError extends Error {
  readonly name = "OperationError";
  constructor(readonly code: ErrorCode, message: string) { super(message); }
}

export class OperationRegistry {
  private readonly operations = new Map<string, OperationDefinition<unknown>>();

  constructor(private readonly refs: CapabilityRefTable) {}

  register<I>(definition: OperationDefinition<I>) {
    operationNameSchema.parse(definition.name);
    if (this.operations.has(definition.name)) throw new Error(`operation already registered: ${definition.name}`);
    this.operations.set(definition.name, definition as OperationDefinition<unknown>);
  }

  names() { return [...this.operations.keys()].sort(); }

  async dispatch(principal: VerifiedPrincipal, raw: unknown, signal: AbortSignal): Promise<RpcResponse> {
    const parsed = rpcRequestSchema.safeParse(raw);
    const id = parsed.success ? parsed.data.id : typeof (raw as { id?: unknown })?.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test((raw as { id: string }).id)
      ? (raw as { id: string }).id : "invalid";
    try {
      if (!parsed.success) throw new OperationError("invalid-request", "request does not match rpc/v1");
      const request = parsed.data;
      const operation = this.operations.get(request.operation);
      if (!operation) throw new OperationError("unknown-operation", request.operation);
      if (!operation.principals.includes(principal.principal.kind)) throw new OperationError("principal-denied", `${principal.principal.kind} may not call ${request.operation}`);
      await principal.refresh?.();
      principal.assertCurrent();
      const expected = operation.refs ?? [];
      const given = request.refs ?? [];
      if (given.length !== expected.length) throw new OperationError("capability-invalid", `expected ${expected.length} refs`);
      const refs = expected.map((kind, index) => this.refs.resolve(given[index]!, kind, principal));
      const input = operation.input.safeParse(request.input);
      if (!input.success) throw new OperationError("input-invalid", input.error.issues[0]?.message ?? "input invalid");
      if (signal.aborted) throw new OperationError("cancelled", "cancelled");
      const result = await operation.handler({ principal, refs, signal }, input.data);
      try { assertStrictJson(result); } catch { throw new OperationError("operation-failed", "operation result is not plain JSON"); }
      return { v: RPC_VERSION, id, ok: true, result };
    } catch (cause) {
      return { v: RPC_VERSION, id, ok: false, error: { code: codeOf(cause), message: messageOf(cause) } };
    }
  }
}

/* Broker refusals keep their meaning across the wire instead of collapsing into operation-failed. */
const BROKER_CODES: Readonly<Record<string, ErrorCode>> = { "principal-denied": "principal-denied", "locator-invalid": "input-invalid",
  "unknown-family": "input-invalid", "family-unavailable": "unavailable", "family-mismatch": "operation-failed" };

function codeOf(cause: unknown): ErrorCode {
  if (cause instanceof OperationError) return cause.code;
  if (cause instanceof OperationBrokerError) return BROKER_CODES[cause.code] ?? "operation-failed";
  if (cause instanceof CapabilityRefError) return cause.code;
  if (cause instanceof PrincipalRevokedError) return "principal-denied";
  if ((cause as { name?: unknown })?.name === "AbortError") return "cancelled";
  return "operation-failed";
}
const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)).slice(0, 1024);
