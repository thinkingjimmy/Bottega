/**
 * [INPUT]: Depends on the shared ACP failure classifier, the error normaliser and the ACP spawn config type
 * [OUTPUT]: Provides validateKimiSessionId and kimiTurnValues, the launch-independent half of the Kimi ACP turn config (with its generic resume-absence matcher)
 * [POS]: Shared by the in-process Kimi turn (providers/kimi/index.ts) and the Kimi Provider bridge; the launch half (command, args, environment) is built only in main by `kimiAcpLaunch`, and Kimi's MCP servers (acp transport, tokens included) reach a bridged session only through main's answer at session creation: nothing here may import the launch
 */
import { classifyAcpFailure } from "../../backends/acp/failure";
import type { AcpSpawnConfig } from "../../backends/acp/launch";
import { asError } from "../../ipc/errors";

const SESSION_PATTERN = /^[A-Za-z0-9._:/-]{1,128}$/;

export const validateKimiSessionId = (id: string) => SESSION_PATTERN.test(id);

export const kimiTurnValues = {
  validateSessionId: validateKimiSessionId,
  /* Kimi's exact absence report is not captured yet, so a resume still reads a generic "session … not found / expired" (F-46 ⑥).
     A readiness or model probe passes no matcher for Kimi: there a refused cleanup stays a failure. */
  sessionMissing: (_sessionId: string, cause: unknown) =>
    /(?:session|conversation).*(?:not found|unknown|does not exist|expired|invalid)/i.test(asError(cause).message),
  resumeWithoutReplay: true,
  /* `auto` is deliberately absent: unlike yolo it also suppresses the
     question channel, silently collapsing a third axis into the permission
     selector and breaking the shared four-backend meaning. Unlock only
     when the product owns an explicit cross-backend Silent Mode axis (L7). */
  modeValues: { default: "default", plan: "plan", approveForMe: "yolo" },
  classifyFailure: classifyAcpFailure,
  reviewResidualApprovals: true,
} as const satisfies Omit<AcpSpawnConfig, "command" | "args" | "env">;
