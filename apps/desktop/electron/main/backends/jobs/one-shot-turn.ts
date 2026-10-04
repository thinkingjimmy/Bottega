/**
 * [INPUT]: Depends on a ProviderBackend's createTurn/validateTurnOptions, the factory chat-option defaults, the per-backend process lease and credential reservation
 * [OUTPUT]: Provides runOneShotTurn: one prompt, one process, the assistant text it produced, with every approval denied, a hard deadline and guaranteed process termination through the turn's process owner (host custody; a reported process with no owner fails closed)
 * [POS]: Sibling of backends/jobs/executor.ts for backends that have no headless path at all; it runs the product's ordinary interactive turn (bridged, like every turn) exactly once instead of a CLI print mode
 */

import { join } from "node:path";
import type { ChatTurnOptions } from "../../../../shared/chat-agent/options";
import {
  DEFAULT_CHAT_OPTIONS_BY_BACKEND,
  backendDefaults,
} from "../../../../shared/chat-agent/options";
import { SubagentRegistry } from "../../../../shared/tools/subagent-registry";
import {
  acquireAgentProcessLease,
  reportAgentCleanupFailure,
  reserveAgentCredentialUse,
} from "../../agent-process-supervisor";
import { asError } from "../../ipc/errors";
import type {
  AgentTurn,
  ProviderBackend,
  BackendTurnOptions,
  ResolvedRuntime,
} from "../types";

export type OneShotTurnJob = {
  descriptor: ProviderBackend;
  runtime: ResolvedRuntime;
  /** Both the process cwd and the only writable root of the turn's fence. */
  workspace: string;
  requestId: string;
  prompt: string;
  model?: string | null;
  timeoutMs: number;
  signal?: AbortSignal;
};

/** Shape-complete but inert: nothing outside this module observes the input. */
const idleInput = (prompt: string): BackendTurnOptions["input"] => ({
  input: [{ type: "text", text: prompt }],
  commit: () => undefined,
  rollback: () => undefined,
  release: async () => undefined,
});

/**
 * The fence needs a control root to deny writes to; it names the product's own
 * channel directory and never has to exist on disk.
 */
const controlRootFor = (workspace: string) =>
  join(workspace, ".bottega-one-shot-control");

/**
 * A one-shot turn is a chat turn with the user removed, so the permission mode
 * is the strictest one every backend accepts and every approval it produces is
 * answered with a refusal. Factory defaults — never the user's chat defaults —
 * supply the remaining required fields, so the backend's own validator stays
 * the single authority on what one of its turns may look like.
 */
function oneShotTurnOptions(
  descriptor: ProviderBackend,
  model: string | null | undefined
): ChatTurnOptions {
  const options = {
    ...backendDefaults(DEFAULT_CHAT_OPTIONS_BY_BACKEND, descriptor.id),
    permissionMode: "ask-for-approval",
    ...(model ? { model } : {}),
  } as ChatTurnOptions;
  descriptor.validateTurnOptions(options);
  return options;
}

/**
 * Runs one prompt on one freshly spawned Agent process and resolves with the
 * assistant text. The process is always terminated before this returns: the
 * deadline asks the session to cancel and then settles regardless, because a
 * background job may not wait on a backend that stopped answering.
 */
export async function runOneShotTurn(job: OneShotTurnJob): Promise<string> {
  const { descriptor, workspace, requestId } = job;
  const turnOptions = oneShotTurnOptions(descriptor, job.model);
  const credentialUse = reserveAgentCredentialUse(descriptor.id);
  await credentialUse.ready;
  const lease = await acquireAgentProcessLease(
    descriptor.id,
    "background",
    job.signal
  ).catch((cause) => {
    credentialUse.release();
    throw cause;
  });

  /* Deltas arrive before an item declares its kind, and a thinking backend streams
     its reasoning through the same channel, so only items the turn finally reports
     as assistant messages count as the answer. */
  const deltas = new Map<string, string>();
  const messages = new Map<string, string>();
  let settle!: (outcome: { text: string } | { error: Error }) => void;
  const outcome = new Promise<{ text: string } | { error: Error }>(
    (resolve) => {
      settle = resolve;
    }
  );
  let turn: AgentTurn | undefined;
  const callbacks: BackendTurnOptions["callbacks"] = {
    onThread: async () => undefined,
    onItemDelta: (itemId, text) => {
      deltas.set(itemId, (deltas.get(itemId) ?? "") + text);
    },
    onItem: (item) => {
      if (item.kind === "agent-message") {
        messages.set(item.itemId, item.text ?? deltas.get(item.itemId) ?? "");
      }
      deltas.delete(item.itemId);
    },
    onItemRemoved: (itemId) => {
      deltas.delete(itemId);
      messages.delete(itemId);
    },
    /* Nobody is watching, so nothing may be granted. */
    onApproval: (approval) => {
      void turn
        ?.respondApproval(approval.approvalId, "decline")
        .catch(() => turn?.interrupt());
    },
    onApprovalClosed: () => undefined,
    onUserInput: () => turn?.interrupt(),
    onTerminal: (event) => {
      if (event.type === "done") {
        settle({ text: [...messages.values()].join("") });
        return;
      }
      settle({
        error: new Error(
          event.message ??
            `${descriptor.displayName} one-shot turn ${event.type}`
        ),
      });
    },
    onProcessError: (failure) => settle({ error: new Error(failure.message) }),
  };

  const deadline = setTimeout(() => {
    turn?.interrupt();
    settle({
      error: new Error(
        `${descriptor.displayName} one-shot turn exceeded ${job.timeoutMs}ms`
      ),
    });
  }, job.timeoutMs);
  const onAbort = () => {
    turn?.interrupt();
    settle({
      error: new Error(`${descriptor.displayName} one-shot turn cancelled`),
    });
  };
  job.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    turn = descriptor.createTurn({
      payload: {
        requestId,
        scope: { conversationId: requestId },
        input: [],
        turnOptions,
      },
      input: idleInput(job.prompt),
      callbacks,
      runtime: job.runtime,
      workspace,
      subagents: new SubagentRegistry(),
      /* The same shape a chat turn carries, so the seatbelt fence applies to a
         background title exactly as it does to the user's own work. */
      filesystemAccess: {
        workspace,
        mode: "read-only",
        readOnlyRoots: [],
        controlRoot: controlRootFor(workspace),
      },
    });
    const active = turn;
    void active.start(job.signal).catch((cause) => {
      settle({ error: asError(cause) });
    });
    const result = await outcome;
    if ("error" in result) throw result.error;
    return result.text;
  } finally {
    clearTimeout(deadline);
    job.signal?.removeEventListener("abort", onAbort);
    turn?.markStopped();
    /* The turn runs on its Provider's bridge and its process belongs to host custody (D7): the owner settles it. A turn that reported a
       process without an owner cannot be proven ours and fails closed. */
    const owner = turn?.processOwner?.();
    const cleanup = owner
      ? await owner.settle().then((verdict) => verdict === "released" ? { ok: true } as const
        : { ok: false as const, error: new Error(`process ${owner.identity.pid} was not confirmed ended`) })
      : turn?.pid ? { ok: false as const, error: new Error(`process ${turn.pid} has no owner`) } : ({ ok: true } as const);
    if (!cleanup.ok) reportAgentCleanupFailure(descriptor.id, cleanup.error);
    lease.release();
    credentialUse.release();
  }
}
