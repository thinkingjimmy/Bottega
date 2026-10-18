/**
 * [INPUT]: Uses product permission/input contracts and CLI-generated native request types.
 * [OUTPUT]: Exports nativePolicy, nativeInput and NativeTurnConfig for bb-native-v1.
 * [POS]: Pure native protocol boundary; selected files use quoted text references, explicit Skills use native activation.
 */
import { fileURLToPath } from "node:url";
import type { AgentPermissionMode } from "../../../../../../shared/ipc/agent/agent-ipc";
import type { ProviderTurnInput } from "../../../../backends/contracts/turn-input";
import type { ThreadStartParams, TurnStartParams, UserInput } from "../schema";

export function nativePolicy(mode: AgentPermissionMode, writableRoots: readonly string[]) {
  const roots = [...new Set(writableRoots)];
  return {
    approvalPolicy: mode === "full-access" ? "never" as const : "on-request" as const,
    approvalsReviewer: mode === "approve-for-me" ? "auto_review" as const : "user" as const,
    sandbox: mode === "full-access" ? "danger-full-access" as const : "workspace-write" as const,
    sandboxPolicy: mode === "full-access" ? { type: "dangerFullAccess" as const } : {
      type: "workspaceWrite" as const, writableRoots: roots, networkAccess: true,
      excludeTmpdirEnvVar: false, excludeSlashTmp: false,
    },
  };
}

export type NativeTurnConfig = {
  contractId: "bb-native-v1";
  continuation?: { threadId: string; lastTurnId: string };
  thread: ThreadStartParams;
  turn: Omit<TurnStartParams, "threadId" | "input">;
};

export function nativeInput(input: readonly ProviderTurnInput[]): UserInput[] {
  return input.map(item => {
    if (item.type === "text") return { type: "text", text: item.text, text_elements: [] };
    if (item.type === "image") return { type: "image", url: `data:${item.mimeType};base64,${item.data}` };
    const url = new URL(item.uri);
    if (url.protocol !== "file:" || url.hostname) throw new Error("Native resource must be a local file reference");
    const path = fileURLToPath(url);
    if (item.resourceKind === "skill") return { type: "skill", name: item.name, path };
    // Native mentions select connectors/plugins; they do not expose ordinary file paths to the model.
    return { type: "text", text: `User-selected context file: ${JSON.stringify({ name: item.name, path })}`, text_elements: [] };
  });
}
