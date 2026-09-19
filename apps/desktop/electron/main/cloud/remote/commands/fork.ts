/**
 * [INPUT]: Exact encrypted command custody, native anchored fork service and durable child receipts.
 * [OUTPUT]: Strict anchor-only preflight and executor-owned creation with private results and immutable replay identity.
 * [POS]: Chat-scoped remote command adapter; native fork owns workspace and attachment lifecycle.
 */
import { remoteOutputSchema, type RemoteCommand, type RemoteOutput } from "@ai-chat/cloud-protocol/remote/model";
import type { ChatsService } from "../../../chats/chats-service";
import type { ChatStore } from "../../../chats/chat-store";
import type { ForkChatPreflightInput, ForkChatRequest } from "../../../../../shared/chats-ipc";
import type { RelayLedger } from "../../../sections/coordinator/relay-ledger";
import type { RemoteContext } from "../../../sections/coordinator/remote/model";
import { canonicalHash } from "../../../sections/coordinator/coordinator-values";
import { controlReport } from "./actions";

export type RemoteForkPort = Pick<ChatsService, "preflightChatFork" | "forkChat">;
type Ports = { ledger: RelayLedger; store: ChatStore; forks: RemoteForkPort };
function forkFailure(cause: unknown): RemoteOutput | null {
  const message = cause instanceof Error ? cause.message : "";
  const code = message.match(/\b(?:CHAT_FORK|PROJECT|GIT|WORKTREE)_[A-Z_]+\b/)?.[0];
  const parsed = remoteOutputSchema.safeParse({ kind: "fork-error", code });
  return parsed.success ? parsed.data : null;
}
export async function applyRemoteFork(command: RemoteCommand, context: RemoteContext, current: () => void, ports: Ports) {
  const { payload } = command;
  if (payload.kind !== "fork-chat") throw new Error("input-unsupported");
  const prior = ports.ledger.remote.control(command.commandId);
  const finish = async (output: RemoteOutput) => controlReport(await ports.ledger.remote.settleControl(command.commandId, "applied", output));
  if (prior) {
    if (!prior.remote || canonicalHash(prior.remote) !== canonicalHash(context)) throw new Error("REMOTE_CONTROL_ID_CONFLICT");
    if (prior.state === "applied") return controlReport(prior);
    if (prior.state !== "not-dispatched" && !payload.checkOnly) {
      const child = await ports.store.forkReplay(prior.payload as ForkChatRequest); current();
      // A committed child is proof; an absent child never licenses a second creation after an uncertain effect.
      if (!child) return controlReport(prior);
      const complete = await ports.forks.forkChat(prior.payload as ForkChatRequest); current();
      return finish({ kind: "fork-chat", chatId: complete.id, incarnationId: complete.incarnationId });
    }
  }
  const authority = ports.ledger.remote.authority(context);
  const validate = async () => {
    current(); await authority.validate(); current(); authority.current();
    const state = await ports.store.sync.read(context.scope, { type: "remote-admission", chatId: context.chatId }); current();
    const head = state.type === "remote-admission" ? state.value?.execution?.head : null;
    if (!head || head.chat.incarnationId !== context.incarnationId) throw new Error("chat-incarnation-mismatch");
    if (head.executorDeviceId !== context.targetDeviceId || head.executionEpoch !== context.executionEpoch) throw new Error("executor-changed");
    authority.current();
  };
  await validate();
  const page = await ports.store.timelineAround({ chatId: context.chatId, messageId: payload.fromMessageId, radius: 1 }); current();
  const anchor = page?.messages.find(message => message.id === payload.fromMessageId);
  if (!page || page.incarnationId !== context.incarnationId || !anchor) throw new Error("chat-incarnation-mismatch");
  const preflightInput: ForkChatPreflightInput = { sourceChatId: context.chatId, sourceIncarnationId: context.incarnationId,
    anchorMessageId: anchor.id, anchorSeq: anchor.seq, mode: payload.execution === "managed-worktree" ? "new-worktree" : "same-workspace" };
  const input: ForkChatRequest = { ...preflightInput, requestId: command.commandId,
    childChatId: `chat_${canonicalHash([context.scope, command.commandId]).slice(0, 32)}` };
  await ports.ledger.remote.reserveControl({ id: command.commandId, conversationId: context.chatId, incarnationId: context.incarnationId,
    requestId: command.commandId, generation: 1, key: `fork:${command.commandId}`, payload: input, payloadHash: canonicalHash(input), remote: context });
  let invoked = false;
  try {
    await validate();
    const preflight = await ports.forks.preflightChatFork(preflightInput); current();
    if (payload.checkOnly) return finish({ kind: "fork-preflight", ...preflight });
    await validate(); invoked = true;
    const child = await ports.forks.forkChat(input, { validate, current: () => { current(); authority.current(); } }); current();
    return finish({ kind: "fork-chat", chatId: child.id, incarnationId: child.incarnationId });
  } catch (cause) {
    current();
    if (invoked) {
      const child = await ports.store.forkReplay(input); current();
      if (child) {
        const complete = await ports.forks.forkChat(input); current();
        return finish({ kind: "fork-chat", chatId: complete.id, incarnationId: complete.incarnationId });
      }
    }
    const failure = forkFailure(cause);
    if (failure) return finish(failure);
    if (!invoked) await ports.ledger.remote.settleControl(command.commandId, "not-dispatched");
    throw cause;
  }
}
