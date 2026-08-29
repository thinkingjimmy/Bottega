/**
 * [INPUT]: Depends on ACP session new/load/resume, frozen BackendTurnOptions/AcpSpawnConfig, configuration convergence, and negotiated server-fact observation
 * [OUTPUT]: Provides establishAcpSession with one bind-and-final-config callback order for fresh and resumed sessions
 * [POS]: ACP turn/session establishment unit; the parent retains transport and terminal ownership
 */

import {
  AGENT_METHODS,
  type ClientContext,
} from "@agentclientprotocol/sdk";
import type { BackendTurnOptions } from "../../types";
import {
  applyTurnConfiguration,
  sessionConfigState,
} from "../session/config";
import type { NegotiatedServerFactsOracle } from "../session/server-facts";
import { assertAcpSessionId } from "../probe";
import {
  acpMcpServers,
  isResumeMissing,
  type AcpSpawnConfig,
} from "./setup";

type EstablishInput = Readonly<{
  context: ClientContext;
  options: BackendTurnOptions;
  config: AcpSpawnConfig;
  serverFacts?: Pick<NegotiatedServerFactsOracle, "observeSession">;
  onSessionId(sessionId: string): void;
}>;

export async function establishAcpSession(
  input: EstablishInput
): Promise<string | undefined> {
  const { context, options, config, serverFacts, onSessionId } = input;
  const resume = options.payload.session;
  if (resume && options.payload.turnOptions.backend !== resume.backend) {
    throw new Error("ACP session 与后端不匹配");
  }
  if (!resume) {
    const created = await context.request(AGENT_METHODS.session_new, {
      cwd: options.workspace,
      mcpServers: acpMcpServers(options, config),
      ...(config.sessionMeta ? { _meta: config.sessionMeta(options) } : {}),
    });
    const id = assertAcpSessionId(created, config.validateSessionId);
    onSessionId(id);
    const state = await applyTurnConfiguration(
      context,
      id,
      created,
      options.payload,
      config
    );
    serverFacts?.observeSession(id, state);
    await publishBoundState(options, id, state);
    return id;
  }
  try {
    const resumed = await context.request(
      config.resumeWithoutReplay
        ? AGENT_METHODS.session_resume
        : AGENT_METHODS.session_load,
      {
        sessionId: resume.id,
        cwd: options.workspace,
        mcpServers: acpMcpServers(options, config),
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
    if (isResumeMissing(cause, config.resumeMissingPolicy)) return undefined;
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
