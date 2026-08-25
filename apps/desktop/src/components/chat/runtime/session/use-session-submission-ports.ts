/**
 * [INPUT]: Depends on React memo, the latest SessionSubmitInput factory, the Conversation Coordinator/Agent queue client
 * [OUTPUT]: Provides useSessionSubmissionPorts and useSessionQueuePorts, all of which are used to read session snapshots every time a call is called back
 * [POS]: The submission port combination layer of chat/runtime/session; use-chat-session not repeatedly pronounced manual/steer/outcome
 */

import { useMemo } from "react";
import {
  ackAgentSteerIntents,
  decideAgentSteer,
  steerAgent,
} from "@/lib/agent-client";
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
    steer: steerAgent,
    decideSteer: decideAgentSteer,
    ackManual: ackManualIntents,
    ackSteer: ackAgentSteerIntents,
    outcome: getSubmissionOutcome,
    ackOutcome: ackSubmissionOutcome,
    subscribeOutcome: subscribeSubmissionOutcomes,
    notice,
  }), [notice, submission]);
}
