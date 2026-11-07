/**
 * [INPUT]: Depends on ACP session load/resume, identity-bound absence classification, actual sent-prompt replay proofs and final session configuration publication.
 * [OUTPUT]: Provides establishAcpSession with one bind-and-final-config callback order for fresh and resumed sessions Opens independent Claude member forks with definite-unsupported-only canonical fallback.
 * [POS]: ACP turn/session establishment unit; the parent retains transport and terminal ownership
 */

import type { SessionReplayProof } from "../../../../library/sessions/boundary";
import {
  AGENT_METHODS,
  type ClientContext,
} from "@agentclientprotocol/sdk";
import type { BackendTurnOptions } from "../../../../backends/contracts/types";
import {
  applyTurnConfiguration,
  sessionConfigState,
} from "../session/config";
import type { NegotiatedServerFactsOracle } from "../session/server-facts";
import { assertAcpSessionId } from "../../../../backends/acp/probe";
import { isResumeMissing } from "./setup";
import { acpMcpServers, type AcpSpawnConfig } from "../../../../backends/acp/launch";

type EstablishInput = Readonly<{
  context: ClientContext;
  options: BackendTurnOptions;
  config: AcpSpawnConfig;
  serverFacts?: Pick<NegotiatedServerFactsOracle, "observeSession">;
  onSessionId(sessionId: string): void;
  replay?: SessionReplayProof;
  onRecoveryOutcome?(outcome: "resumed" | "replayed"): void;
  supportsFork?: boolean;
  onForked?(): void;
}>;

const sessionMcpServers = (options: EstablishInput["options"], config: EstablishInput["config"]) =>
  config.resolveMcpServers?.() ?? acpMcpServers(options, config);

export async function establishAcpSession(
  input: EstablishInput
): Promise<string | undefined> {
  const { context, options, config, serverFacts, onSessionId } = input;
  const resume = options.payload.session;
  if (resume && options.payload.turnOptions.backend !== resume.backend) {
    throw new Error("ACP session 与后端不匹配");
  }
  const fork = !resume ? options.memberFork : undefined;
  if (fork && (fork.backend !== "claude" || options.payload.turnOptions.backend !== "claude"))
    throw new Error("ACP member fork belongs to a different Provider");
  if (fork && input.supportsFork) {
    let created: unknown;
    try {
      created = await context.request(AGENT_METHODS.session_fork, {
        sessionId: fork.sourceSessionId, cwd: options.workspace, mcpServers: await sessionMcpServers(options, config),
        ...(config.sessionMeta ? { _meta: config.sessionMeta(options) } : {}),
      });
    } catch (cause) {
      if ((cause as { code?: number })?.code !== -32601 && !isResumeMissing(cause, config, fork.sourceSessionId)) throw cause;
    }
    if (created) {
      const id = assertAcpSessionId(created, config.validateSessionId);
      if (id === fork.sourceSessionId) throw new Error("ACP member fork returned its parent identity");
      const state = await applyTurnConfiguration(context, id, sessionConfigState(created), options.payload, config);
      await fork.complete("forked");
      onSessionId(id); serverFacts?.observeSession(id, state);
      await publishBoundState(options, id, state); input.onForked?.(); return id;
    }
  }
  const recovery = !resume && !fork ? options.sessionRecovery : undefined;
  if (recovery?.candidate && input.replay && config.validateSessionId(recovery.candidate.sessionId)) {
    const candidate = recovery.candidate;
    input.replay.begin(candidate.sessionId);
    let loaded: unknown = null, verified = false;
    try {
      loaded = await context.request(AGENT_METHODS.session_load, {
        sessionId: candidate.sessionId, cwd: options.workspace, mcpServers: await sessionMcpServers(options, config),
        ...(config.sessionMeta ? { _meta: config.sessionMeta(options) } : {}),
      });
      verified = input.replay.matches(candidate.boundary, candidate.sentBoundary);
    } catch (cause) {
      if (!isResumeMissing(cause, config, candidate.sessionId) && (cause as { code?: number })?.code !== -32601) throw cause;
    } finally { input.replay.end(); }
    if (verified) {
      onSessionId(candidate.sessionId);
      const state = await applyTurnConfiguration(context, candidate.sessionId, sessionConfigState(loaded), options.payload, config);
      serverFacts?.observeSession(candidate.sessionId, state);
      await recovery.complete("resumed"); input.onRecoveryOutcome?.("resumed");
      await publishBoundState(options, candidate.sessionId, state); return candidate.sessionId;
    }
  }
  if (!resume) {
    const created = await context.request(AGENT_METHODS.session_new, {
      cwd: options.workspace, mcpServers: await sessionMcpServers(options, config),
      ...(config.sessionMeta ? { _meta: config.sessionMeta(options) } : {}),
    });
    const id = assertAcpSessionId(created, config.validateSessionId);
    if (fork && id === fork.sourceSessionId) throw new Error("ACP fresh session reused its parent identity");
    if (fork) await fork.complete("replayed");
    onSessionId(id);
    const state = await applyTurnConfiguration(context, id, created, options.payload, config);
    serverFacts?.observeSession(id, state);
    if (recovery) { await recovery.complete("replayed"); input.onRecoveryOutcome?.("replayed"); }
    await publishBoundState(options, id, state); return id;
  }
  try {
    const resumed = await context.request(
      config.resumeWithoutReplay
        ? AGENT_METHODS.session_resume
        : AGENT_METHODS.session_load,
      {
        sessionId: resume.id,
        cwd: options.workspace,
        mcpServers: await sessionMcpServers(options, config),
        ...(config.sessionMeta ? { _meta: config.sessionMeta(options) } : {}),
      }
    );
    onSessionId(resume.id);
    const state = await applyTurnConfiguration(
      context,
      resume.id,
      sessionConfigState(resumed),
      options.payload,
      config
    );
    serverFacts?.observeSession(resume.id, state);
    await publishBoundState(options, resume.id, state);
    return resume.id;
  } catch (cause) {
    if (isResumeMissing(cause, config, resume.id)) return undefined;
    throw cause;
  }
}

async function publishBoundState(
  options: BackendTurnOptions,
  id: string,
  state: ReturnType<typeof sessionConfigState>
) {
  await options.callbacks.onThread({
    backend: options.payload.turnOptions.backend,
    id,
  });
  /* set_config_option may emit updates before a fresh session is bound.
     The returned final state is authoritative and is replayed only after bind. */
  options.callbacks.onConfigOptionUpdate?.(state.configOptions ?? []);
}
