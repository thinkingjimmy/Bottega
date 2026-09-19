/**
 * [INPUT]: Depends on a BackendDescriptor's createTurn/validateTurnOptions, the factory chat-option defaults, the per-backend process lease, credential reservation and auxiliary process registration, and the shared process-group cleanup
 * [OUTPUT]: Provides runOneShotTurn: one prompt, one process, the assistant text it produced, with every approval denied, a hard deadline and guaranteed process termination
 * [POS]: Sibling of headless-executor for backends that have no headless path at all; it runs the product's ordinary interactive turn exactly once instead of a CLI print mode
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";
import type { AgentTurnOptions } from "../../../shared/agent-ipc";
import {
  DEFAULT_CHAT_OPTIONS_BY_BACKEND,
  backendDefaults,
} from "../../../shared/chat-agent/options";
import { SubagentRegistry } from "../../../shared/subagent-registry";
import {
  acquireAgentProcessLease,
  registerAuxiliaryAgentProcess,
  reportAgentCleanupFailure,
  reserveAgentCredentialUse,
  type AuxiliaryProcessRegistration,
} from "../agent-process-supervisor";
import { asError } from "../errors";
import { cleanProcessGroup } from "../process-group";
import type {
  AgentProcessHost,
  AgentTurn,
  BackendDescriptor,
  BackendTurnOptions,
  ResolvedRuntime,
} from "./types";

export type OneShotTurnJob = {
  descriptor: BackendDescriptor;
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
  descriptor: BackendDescriptor,
  model: string | null | undefined
): AgentTurnOptions {
  const options = {
    ...backendDefaults(DEFAULT_CHAT_OPTIONS_BY_BACKEND, descriptor.id),
    permissionMode: "ask-for-approval",
    ...(model ? { model } : {}),
  } as AgentTurnOptions;
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

  let unregister: AuxiliaryProcessRegistration | undefined;
  let settleProcess!: () => void;
  const processSettled = new Promise<void>((resolve) => {
    settleProcess = resolve;
  });
  const host: AgentProcessHost = {
    launch: (request) => {
      const child: ChildProcessWithoutNullStreams = spawn(
        request.command,
        [...request.args],
        { cwd: request.cwd, detached: true, env: request.env }
      );
      try {
        unregister = registerAuxiliaryAgentProcess(
          descriptor.id,
          child,
          processSettled
        );
      } catch (cause) {
        /* Registration is the supervisor's only record of this process; without
           it nobody would ever reap the child we just detached. */
        if (child.pid) {
          void cleanProcessGroup(child.pid).catch(() => undefined);
        }
        throw cause;
      }
      return child;
    },
    delivered: Promise.resolve(),
  };

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
      processHost: host,
      subagents: new SubagentRegistry(),
      /* The same shape a chat turn carries, so the seatbelt fence applies to a
         background title exactly as it does to the user's own work. */
      filesystemAccess: {
        workspace,
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
    const cleanup = turn?.pid
      ? await cleanProcessGroup(turn.pid).catch((cause) => ({
          ok: false as const,
          error: asError(cause),
        }))
      : ({ ok: true } as const);
    if (!cleanup.ok) {
      reportAgentCleanupFailure(descriptor.id, cleanup.error, unregister?.owner);
    } else {
      unregister?.();
    }
    settleProcess();
    lease.release();
    credentialUse.release();
  }
}
