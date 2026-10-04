/**
 * [INPUT]: Depends on the OperationRegistry, VerifiedPrincipal, the public records contract and BasePublicPorts
 * [OUTPUT]: Provides registerBaseOperations (the eleven `base.*` operations) and callerOf (VerifiedPrincipal → PortCaller)
 * [POS]: The RPC face of the Base public ports; an Agent turn arrives through its execution ref, a host package as its own App-surface principal, and a Workflow run principal is refused (the run owner acts only through the workflow authority)
 */
import type { z } from "zod";
import type { JsonValue } from "@ai-chat/cloud-protocol/contracts/canonical";
import { attachmentInputSchema, BASE_OPERATIONS, describeInputSchema, queryInputSchema, readInputSchema, reportInputSchema, resultReadInputSchema,
  resultsInputSchema, rowsDeleteInputSchema, rowsInsertInputSchema, rowsPatchInputSchema, writeFieldsInputSchema } from "@ai-chat/cloud-protocol/contracts/base/records";
import { OperationError, type OperationRegistry } from "../../operations/registry";
import type { VerifiedPrincipal } from "../../operations/principals";
import type { BasePublicPorts, PortCaller } from "./ports";

export function callerOf(verified: VerifiedPrincipal): PortCaller {
  const principal = verified.principal;
  if (principal.kind === "agent-turn") return { kind: "agent-turn", key: verified.key, chat: principal.chat };
  if (principal.kind === "app-surface") return { kind: "package", key: verified.key, installIdentity: principal.appId, generationId: principal.generationId };
  throw new OperationError("principal-denied", `${principal.kind} may not use Base ports`);
}

/* HTTP-style statuses from the Base kernel keep their meaning on the wire; the kernel code rides in the message. */
function wireError(cause: unknown) {
  if (cause instanceof OperationError) return cause;
  const { status, code } = cause as { status?: number; code?: string };
  const message = `${code ?? "error"}: ${(cause as Error).message}`;
  return new OperationError(status === 403 ? "principal-denied" : status === 400 ? "input-invalid" : "operation-failed", message);
}

export function registerBaseOperations(registry: OperationRegistry, ports: BasePublicPorts) {
  const add = <S extends z.ZodType>(name: string, input: S, risk: "read" | "write", run: (caller: PortCaller, input: z.output<S>) => Promise<unknown>) =>
    registry.register({ name, input, risk, principals: ["agent-turn", "app-surface"],
      handler: async ({ principal }, value) => {
        try { return JSON.parse(JSON.stringify(await run(callerOf(principal), value as z.output<S>))) as JsonValue; }
        catch (cause) { throw wireError(cause); }
      } });
  add(BASE_OPERATIONS.describe, describeInputSchema, "read", (caller, input) => ports.describe(caller, input));
  add(BASE_OPERATIONS.query, queryInputSchema, "read", (caller, input) => ports.query(caller, input));
  add(BASE_OPERATIONS.read, readInputSchema, "read", (caller, input) => ports.read(caller, input));
  add(BASE_OPERATIONS.insert, rowsInsertInputSchema, "write", (caller, input) => ports.rows(caller, "insert", input));
  add(BASE_OPERATIONS.patch, rowsPatchInputSchema, "write", (caller, input) => ports.rows(caller, "patch", input));
  add(BASE_OPERATIONS.delete, rowsDeleteInputSchema, "write", (caller, input) => ports.rows(caller, "delete", input));
  add(BASE_OPERATIONS.writeFields, writeFieldsInputSchema, "write", (caller, input) => ports.writeFields(caller, input));
  add(BASE_OPERATIONS.attachment, attachmentInputSchema, "read", (caller, input) => ports.attachment(caller, input));
  add(BASE_OPERATIONS.report, reportInputSchema, "write", (caller, input) => ports.report(caller, input));
  add(BASE_OPERATIONS.results, resultsInputSchema, "read", (caller, input) => ports.results(caller, input));
  add(BASE_OPERATIONS.result, resultReadInputSchema, "read", (caller, input) => ports.result(caller, input));
}
