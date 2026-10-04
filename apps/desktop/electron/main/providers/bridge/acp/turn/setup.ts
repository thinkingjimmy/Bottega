/**
 * [INPUT]: Depends on ACP ContentBlock, Node spawn, process/turn contracts, the spawn config's session-absence matcher and resolved input blocks
 * [OUTPUT]: Provides processHostOf (default process host), isResumeMissing and promptBlocks
 * [POS]: Startup configuration and pure projection layer for providers/bridge/acp/turn; AcpTurn retains only the protocol state machine and single-turn lifecycle
 */

import type { ContentBlock } from "@agentclientprotocol/sdk";
import { spawn } from "node:child_process";
import type { AgentProcessHost, AgentProcessLauncher, BackendTurnOptions } from "../../../../backends/types";

import { resolvedInputBlocks } from "../../../../backends/acp/input-blocks";
import type { AcpSpawnConfig } from "../../../../backends/acp/launch";

/** 无 custody 时的缺省宿主，也是测试注入假 child 的唯一入口。 */
export function processHostOf(
  launch: AgentProcessLauncher = (request) =>
    spawn(request.command, [...request.args], {
      cwd: request.cwd,
      detached: true,
      env: request.env,
    })
): AgentProcessHost {
  return { launch, delivered: Promise.resolve() };
}

/** A resume refused because the session is gone, as the Provider's own matcher reads it; without one, never. */
export function isResumeMissing(cause: unknown, config: Pick<AcpSpawnConfig, "sessionMissing">, sessionId: string) {
  return config.sessionMissing?.(sessionId, cause) ?? false;
}

export async function promptBlocks(options: BackendTurnOptions, restoredSessionResumed = false): Promise<ContentBlock[]> {
  const blocks: ContentBlock[] = [];
  if (options.productContext) {
    blocks.push({ type: "text", text: options.productContext });
  }
  if (options.sensitiveContribution) {
    /* Awaited: a bridged turn's contribution is consumed in main, and the prompt must not be decided before its answer (G9). */
    const validation = await options.sensitiveContribution.consume();
    options.onPromptContributionValidation?.(validation);
    if (validation.kind === "allowed") {
      blocks.push({
        type: "text",
        text: options.sensitiveContribution.text,
      });
    }
  }
  blocks.push(...resolvedInputBlocks(restoredSessionResumed ? options.input.input.filter(item => item.type !== "text" || item.text !== options.payload.handoff?.text) : options.input.input));
  return blocks;
}
