/**
 * [INPUT]: Depends on React memo, fresh SessionSubmitInput, the native CommandSink and existing coordinator outcome clients.
 * [OUTPUT]: Provides useSessionSubmissionPorts and useSessionQueuePorts, whose stable callbacks each read a fresh SessionSubmitInput snapshot at call time rather than closing over stale state
 * [POS]: The submission-port composition layer of chat/runtime/session; keeps use-chat-session from redeclaring manual/steer/outcome wiring itself
 */

import { useMemo } from "react";
import {
  ackAgentSteerIntents,
  decideAgentSteer,
} from "@/lib/agent-client";
import { nativeChatCommands } from "@/lib/cloud/chat/platform/commands";
import {
  ackManualIntents,
  ackSubmissionOutcome,
  getSubmissionOutcome,
  subscribeSubmissionOutcomes,
} from "@/lib/sections-client";
import {
  createSessionSubmissionPorts,
  type SessionSubmissionPorts,
  type SessionSubmitInput,
} from "./create-session-submit";

export function useSessionSubmissionPorts(
  buildSubmissionInput: () => SessionSubmitInput
) {
  return useMemo<SessionSubmissionPorts>(() => {
    const ports = () => createSessionSubmissionPorts(buildSubmissionInput());
    return {
      assembleSubmission: (message, options) => ports().assembleSubmission(message, options),
      admitSubmission: (envelope) => ports().admitSubmission(envelope),
      assembleSteer: (message, identity) => ports().assembleSteer(message, identity),
      assembleRevision: (messageId, content) => ports().assembleRevision(messageId, content),
    };
  }, [buildSubmissionInput]);
}

export function useSessionQueuePorts(
  submission: SessionSubmissionPorts,
  notice: (message: string) => void
) {
  return useMemo(() => ({
    assemble: submission.assembleSubmission,
    admit: submission.admitSubmission,
    assembleSteer: submission.assembleSteer,
    steer: nativeChatCommands.steer,
    decideSteer: decideAgentSteer,
    ackManual: ackManualIntents,
    ackSteer: ackAgentSteerIntents,
    outcome: getSubmissionOutcome,
    ackOutcome: ackSubmissionOutcome,
    subscribeOutcome: subscribeSubmissionOutcomes,
    notice,
  }), [notice, submission]);
}
