/**
 * [INPUT]: Depends on React callback identity, createSessionRevisionSubmit, and a factory that reads the latest SessionSubmitInput per call
 * [OUTPUT]: Provides the stable useSessionRevision submission callback without transient presentation state
 * [POS]: The chat/runtime/session revision submission adapter; durable replacement remains owned by create-session-submit
 */

import { useCallback } from "react";
import {
  createSessionRevisionSubmit,
  type SessionSubmitInput,
} from "./create-session-submit";

export function useSessionRevision(
  buildSubmissionInput: () => SessionSubmitInput
) {
  return useCallback(
    (messageId: string, content: string) =>
      createSessionRevisionSubmit(buildSubmissionInput())(messageId, content),
    [buildSubmissionInput]
  );
}
