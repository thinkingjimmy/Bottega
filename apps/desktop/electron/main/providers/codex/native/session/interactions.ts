/**
 * [INPUT]: Uses generated native approval/question payloads, live RPC and product callbacks.
 * [OUTPUT]: Exports NativeInteractions for one-shot approvals and questions bound to one native connection.
 * [POS]: Native turn interaction owner; closing a turn invalidates every outstanding decision.
 */
import type { AgentApprovalDecision, AgentUserInputAnswers, AgentUserInputQuestion } from "../../../../../../shared/ipc/agent/agent-ipc";
import type { BackendTurnOptions } from "../../../../backends/contracts/types";
import type { CommandExecutionRequestApprovalParams, FileChangeRequestApprovalParams, ToolRequestUserInputParams, PermissionsRequestApprovalParams } from "../schema";
import type { NativeConnection, NativeMessage } from "../transport/connection";
import { nativeRecord } from "../transport/record";

type Approval = { id: number | string; accept: unknown; decline: unknown };
type Question = { id: number | string; questions: AgentUserInputQuestion[]; elicitation: boolean };
export class NativeInteractions {
  private readonly approvals = new Map<string, Approval>();
  private readonly questions = new Map<string, Question>();
  constructor(private readonly rpc: NativeConnection, private readonly options: BackendTurnOptions,
    private readonly scope: () => { threadId: string; turnId: string } | null, private readonly redact: (text: string) => string, private readonly fileChange: (itemId: string) => string | undefined) {}

  receive(message: NativeMessage) {
    if (message.id === undefined) return;
    const scope = this.scope(), params = nativeRecord(message.params);
    if (!scope || params.threadId !== scope.threadId || (params.turnId != null && params.turnId !== scope.turnId)) {
      this.rpc.reject(message.id, "Native request is outside the active thread/turn"); return;
    }
    const key = `${this.options.payload.requestId}:native:${message.id}`;
    if (this.approvals.has(key) || this.questions.has(key)) { this.rpc.reject(message.id, "Duplicate native interaction"); return; }
    switch (message.method) {
      case "item/commandExecution/requestApproval": {
        const p = params as unknown as CommandExecutionRequestApprovalParams;
        if (p.availableDecisions && !p.availableDecisions.includes("accept")) { this.rpc.reject(message.id, "This approval requires an unsupported decision scope"); return; }
        this.approvals.set(key, { id: message.id, accept: { decision: "accept" }, decline: { decision: "decline" } });
        this.options.callbacks.onApproval({ approvalId: key, kind: "command", command: this.redact(p.command ?? ""), cwd: p.cwd ?? undefined,
          reason: this.redact([p.reason, p.additionalPermissions ? JSON.stringify(p.additionalPermissions) : ""].filter(Boolean).join("\n")), canAcceptForSession: false }); break;
      }
      case "item/fileChange/requestApproval": {
        const p = params as unknown as FileChangeRequestApprovalParams;
        if (p.grantRoot) { this.rpc.respond(message.id, { decision: "decline" }); this.options.callbacks.onItem({ itemId: key, kind: "other", title: "Session-wide file access is unsupported", status: "failed" }); return; }
        this.approvals.set(key, { id: message.id, accept: { decision: "accept" }, decline: { decision: "decline" } });
        this.options.callbacks.onApproval({ approvalId: key, kind: "file-change", diff: this.redact(this.fileChange(p.itemId) ?? ""), reason: this.redact(p.reason ?? ""), canAcceptForSession: false }); break;
      }
      case "item/permissions/requestApproval": {
        const p = params as unknown as PermissionsRequestApprovalParams;
        const permissions = { ...(p.permissions?.fileSystem ? { fileSystem: p.permissions.fileSystem } : {}), ...(p.permissions?.network ? { network: p.permissions.network } : {}) };
        this.approvals.set(key, { id: message.id, accept: { permissions, scope: "turn" }, decline: { permissions: {}, scope: "turn" } });
        this.options.callbacks.onApproval({ approvalId: key, kind: "permissions", cwd: p.cwd, reason: this.redact(`${p.reason ?? ""}\n${JSON.stringify(permissions)}`), canAcceptForSession: false }); break;
      }
      case "item/tool/requestUserInput": {
        const p = params as unknown as ToolRequestUserInputParams;
        const questions = p.questions.map(q => ({ id: q.id, question: this.redact(q.question), header: this.redact(q.header),
          isOther: q.isOther, isSecret: q.isSecret, ...(q.options ? { options: q.options.map(o => ({ label: this.redact(o.label), description: this.redact(o.description) })) } : {}) }));
        this.questions.set(key, { id: message.id, questions, elicitation: false });
        this.options.callbacks.onUserInput?.({ userInputId: key, itemId: p.itemId, session: { backend: "codex", id: scope.threadId }, turnId: scope.turnId, questions }); break;
      }
      case "mcpServer/elicitation/request": {
        if (params.mode !== "form" && params.mode !== "openai/form" && params.mode !== "openaiForm") {
          this.rpc.respond(message.id, { action: "cancel", content: null, _meta: null }); return;
        }
        const schema = nativeRecord(params.requestedSchema), properties = nativeRecord(schema.properties);
        const required = Array.isArray(schema.required) ? schema.required : [];
        if (Object.keys(properties).length > 16 || Object.values(properties).some(p => nativeRecord(p).type !== "string")) {
          this.rpc.respond(message.id, { action: "cancel", content: null, _meta: null }); return;
        }
        const questions = Object.entries(properties).map(([id, value]) => { const p = nativeRecord(value); return { id,
          header: String(p.title ?? id), question: this.redact(String(p.description ?? params.message ?? id)), required: required.includes(id), isOther: true,
          ...(Array.isArray(p.enum) ? { options: p.enum.filter(v => typeof v === "string").map(label => ({ label: String(label), description: "" })) } : {}) }; });
        this.questions.set(key, { id: message.id, questions, elicitation: true });
        this.options.callbacks.onUserInput?.({ userInputId: key, itemId: key, session: { backend: "codex", id: scope.threadId }, turnId: scope.turnId, questions }); break;
      }
      default: this.rpc.reject(message.id, `Unsupported native request: ${message.method}`);
    }
  }

  async respondApproval(key: string, decision: AgentApprovalDecision) {
    const pending = this.approvals.get(key);
    if (!pending || (decision !== "accept" && decision !== "decline")) throw new Error("Native approval expired or decision scope is unsupported");
    this.approvals.delete(key);
    this.rpc.respond(pending.id, decision === "accept" ? pending.accept : pending.decline);
    this.options.callbacks.onApprovalClosed(key);
  }
  pendingUserInput(key: string) { const pending = this.questions.get(key); return pending ? { questions: pending.questions } : undefined; }
  respondUserInput(key: string, answers: AgentUserInputAnswers) {
    const pending = this.questions.get(key);
    if (!pending) throw new Error("Native question expired");
    const sanitized: AgentUserInputAnswers = {};
    for (const q of pending.questions) {
      const a = answers[q.id]?.answers ?? [];
      if (a.length > 32 || a.some(value => typeof value !== "string" || value.length > 65_536)) throw new Error("Invalid native answer");
      sanitized[q.id] = { answers: a };
    }
    this.questions.delete(key);
    this.rpc.respond(pending.id, pending.elicitation ? { action: Object.keys(answers).length ? "accept" : "cancel",
      content: Object.fromEntries(Object.entries(sanitized).map(([id, value]) => [id, value.answers[0] ?? ""])), _meta: null } : { answers: sanitized });
    this.options.callbacks.onUserInputClosed?.(key);
  }
  close() {
    for (const [key, p] of this.approvals) { this.rpc.respond(p.id, p.decline); this.options.callbacks.onApprovalClosed(key); }
    for (const [key, p] of this.questions) { this.rpc.respond(p.id, p.elicitation ? { action: "cancel", content: null, _meta: null } : { answers: {} }); this.options.callbacks.onUserInputClosed?.(key); }
    this.approvals.clear(); this.questions.clear();
  }
}
